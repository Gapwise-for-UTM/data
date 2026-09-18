import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TTB_BASE = "https://api.easi.utoronto.ca/ttb";
const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const TORONTO_BUILDINGS =
  "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_PROP_BUILDINGOUTLINES_A/FeatureServer/111/query";

const CAMPUS_CONFIG = {
  utsg: {
    label: "St. George",
    sourcePath: "data/utsg/source.json",
    inventoryPath: "data/utsg/sources/official-facilities.json",
    aliasPath: "data/utsg/sources/reconciliation-aliases.json",
  },
  utsc: {
    label: "Scarborough",
    sourcePath: "data/utsc/source.json",
    inventoryPath: "data/utsc/sources/official-buildings.json",
    aliasPath: "data/utsc/sources/reconciliation-aliases.json",
  },
};

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bctr\b/g, " centre ")
    .replace(/\bcenter\b/g, " centre ")
    .replace(/\blaboratories\b/g, " labs ")
    .replace(/\blaboratory\b/g, " lab ")
    .replace(/\bbuilding\b/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableUnique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

async function writeJson(path, value) {
  const absolute = resolve(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fetchWithRetry(url, init = {}, label = url) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          accept: "application/json",
          "user-agent": "Gapwise-Data/tri-campus-refresh (+https://data.gapwise.ca)",
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        throw new Error(`${label} returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500 * attempt));
    }
  }
  throw lastError;
}

async function fetchJson(url, init = {}, label = url) {
  return (await fetchWithRetry(url, init, label)).json();
}

async function ttbContext() {
  const reference = await fetchJson(`${TTB_BASE}/reference-data`, {}, "TTB reference-data");
  const payload = reference.payload ?? {};
  // The UI exposes sub-session values such as 20269F/20269S, while the course
  // search endpoint accepts the five-digit parent session (for example 20269).
  const sessions = (payload.currentSessions ?? [])
    .filter((option) => !option.header)
    .map((option) => String(option.value ?? "").match(/^\d{5}/)?.[0] ?? "")
    .filter(Boolean);
  const divisions = (payload.divisions ?? [])
    .filter((option) => !option.header)
    .map((option) => String(option.value ?? ""))
    .filter(Boolean);
  if (!sessions.length) throw new Error("TTB reference-data did not expose usable current session values.");
  if (!divisions.length) throw new Error("TTB reference-data did not expose academic divisions.");
  return { sessions: stableUnique(sessions), divisions: stableUnique(divisions) };
}

async function fetchTtbCoursePage({ campusLabel, session, division, page, pageSize }) {
  const body = {
    courseCodeAndTitleProps: {
      courseCode: "",
      courseTitle: "",
      courseSectionCode: "",
      searchCourseDescription: true,
    },
    departmentProps: [],
    campuses: [campusLabel],
    sessions: [session],
    requirementProps: [],
    instructor: "",
    courseLevels: [],
    deliveryModes: [],
    dayPreferences: [],
    timePreferences: [],
    divisions: [division],
    creditWeights: [],
    page,
    pageSize,
    direction: "asc",
  };
  const response = await fetch(`${TTB_BASE}/getPageableCourses`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "Gapwise-Data/tri-campus-refresh (+https://data.gapwise.ca)",
    },
    body: JSON.stringify(body),
  });
  if (response.status === 404) {
    // TTB represents a valid search with no matches as HTTP 404 / app status 4404.
    return { courses: [], total: 0 };
  }
  if (!response.ok) {
    throw new Error(
      `TTB getPageableCourses ${campusLabel}/${session}/${division} page ${page} returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`,
    );
  }
  const envelope = await response.json();
  const pageable = envelope.payload?.pageableCourse ?? {};
  return {
    courses: Array.isArray(pageable.courses) ? pageable.courses : [],
    total: Number.isFinite(pageable.total) ? pageable.total : 0,
  };
}

async function fetchTtbBuildings(campusLabel, sessions, divisions) {
  const buildings = new Map();
  const pageSize = 500;
  let courseCount = 0;

  function collect(courses) {
    courseCount += courses.length;
    for (const course of courses) {
      for (const section of course.sections ?? []) {
        for (const meeting of section.meetingTimes ?? []) {
          const building = meeting.building;
          const code = String(building?.buildingCode ?? "").trim().toUpperCase();
          const name = String(building?.buildingName ?? "").trim();
          if (!code) continue;
          const key = `${code}\u0000${normalize(name)}`;
          const current = buildings.get(key) ?? {
            code,
            name,
            mapUrl: building.buildingUrl || null,
            roomSamples: new Set(),
            courseSamples: new Set(),
          };
          const room = `${building.buildingRoomNumber ?? ""}${building.buildingRoomSuffix ?? ""}`.trim();
          if (room && current.roomSamples.size < 8) current.roomSamples.add(room);
          if (course.code && current.courseSamples.size < 8) current.courseSamples.add(course.code);
          if (!current.mapUrl && building.buildingUrl) current.mapUrl = building.buildingUrl;
          buildings.set(key, current);
        }
      }
    }
  }

  // Query one division/session at a time. This matches the production TTB UI
  // contract and avoids relying on the large, less stable all-courses response.
  for (const session of sessions) {
    for (const division of divisions) {
      const first = await fetchTtbCoursePage({
        campusLabel,
        session,
        division,
        page: 1,
        pageSize,
      });
      collect(first.courses);
      const pageCount = Math.ceil(first.total / pageSize);
      for (let page = 2; page <= pageCount; page += 1) {
        const next = await fetchTtbCoursePage({
          campusLabel,
          session,
          division,
          page,
          pageSize,
        });
        collect(next.courses);
      }
    }
  }

  if (!buildings.size) {
    throw new Error(
      `TTB returned no physical building evidence for ${campusLabel} across ${courseCount} matched courses (${sessions.join(", ")}; ${divisions.length} divisions).`,
    );
  }
  return [...buildings.values()]
    .map((entry) => ({
      code: entry.code,
      name: entry.name,
      mapUrl: entry.mapUrl,
      roomSamples: [...entry.roomSamples].sort(),
      courseSamples: [...entry.courseSamples].sort(),
    }))
    .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
}

function recordNames(record) {
  return stableUnique([record.name, ...(record.aliases ?? []), ...(record.sourceNames ?? [])]);
}

function canonicalizeInventory(campus, sourceInventory, ttbBuildings, aliases) {
  const active = sourceInventory.records.filter((record) => record.status !== "demolished");
  const byId = new Map();
  const nameToId = new Map();

  for (const record of active) {
    const facilityCodes = record.facilityCode ? [String(record.facilityCode)] : [];
    const timetableCodes = record.timetableCode ? [String(record.timetableCode).toUpperCase()] : [];
    const sourceKey = record.facilityCode ? `facility:${String(record.facilityCode)}` : record.sourceKey;
    if (campus === "utsg" && !sourceKey) {
      throw new Error(`utsg: source record ${record.name} is missing facilityCode/sourceKey`);
    }
    const id =
      campus === "utsc"
        ? `${campus}:${String(record.code).toUpperCase()}`
        : `${campus}:${sourceKey}`;
    const canonical = {
      id,
      campus,
      code:
        timetableCodes[0] ??
        (campus === "utsc" ? String(record.code).toUpperCase() : String(record.facilityCode ?? "")),
      name: record.name,
      category: record.category ?? "facility",
      aliases: stableUnique(record.aliases ?? []),
      timetableCodes,
      facilityCodes,
      mapUrls: [],
      identityEvidence: stableUnique([sourceInventory.sourceId, record.sourceId]),
      sourceNames: [record.name],
      status: "active",
    };
    byId.set(id, canonical);
    for (const name of recordNames(canonical)) nameToId.set(normalize(name), id);
  }

  const sourceTargetToId = new Map();
  for (const record of active) {
    const id =
      campus === "utsc"
        ? `${campus}:${String(record.code).toUpperCase()}`
        : `${campus}:${record.facilityCode ? `facility:${String(record.facilityCode)}` : record.sourceKey}`;
    if (campus === "utsc") sourceTargetToId.set(String(record.code).toUpperCase(), id);
    if (record.facilityCode) sourceTargetToId.set(String(record.facilityCode), id);
    if (record.sourceKey) sourceTargetToId.set(String(record.sourceKey), id);
  }

  const resolveTarget = (target, label) => {
    const key = campus === "utsc" ? String(target).toUpperCase() : String(target);
    const id = sourceTargetToId.get(key);
    if (!id || !byId.has(id)) throw new Error(`${campus}: ${label} targets unknown ${target}`);
    return id;
  };

  const explicitAliasToId = new Map();
  for (const [aliasName, target] of Object.entries(aliases.names ?? {})) {
    explicitAliasToId.set(normalize(aliasName), resolveTarget(target, `reconciliation alias ${aliasName}`));
  }

  const explicitCodeToId = new Map();
  for (const [code, target] of Object.entries(aliases.codes ?? {})) {
    explicitCodeToId.set(
      String(code).toUpperCase(),
      resolveTarget(target, `timetable-code alias ${code}`),
    );
  }

  const unresolvedTtb = [];
  for (const ttb of ttbBuildings) {
    const ttbCode = ttb.code.toUpperCase();
    if (
      Object.prototype.hasOwnProperty.call(aliases.nonPhysicalCodes ?? {}, ttbCode) ||
      Object.prototype.hasOwnProperty.call(aliases.excludedTimetableCodes ?? {}, ttbCode)
    ) {
      continue;
    }
    const norm = normalize(ttb.name);
    let id =
      explicitCodeToId.get(ttb.code.toUpperCase()) ??
      (norm ? explicitAliasToId.get(norm) ?? nameToId.get(norm) ?? null : null);
    if (!id && campus === "utsc") {
      const codeId = `${campus}:${ttb.code.toUpperCase()}`;
      if (byId.has(codeId)) id = codeId;
    }
    if (!id) {
      unresolvedTtb.push({
        code: ttb.code,
        name: ttb.name || null,
        mapUrl: ttb.mapUrl || null,
      });
      continue;
    }
    const canonical = byId.get(id);
    canonical.timetableCodes = stableUnique([...canonical.timetableCodes, ttb.code.toUpperCase()]);
    canonical.mapUrls = stableUnique([...canonical.mapUrls, ttb.mapUrl]);
    canonical.identityEvidence = stableUnique([...canonical.identityEvidence, "uoft-ttb-live"]);
    canonical.sourceNames = stableUnique([...canonical.sourceNames, ttb.name]);
    if (/^\d/.test(canonical.code) || !canonical.code) canonical.code = canonical.timetableCodes[0] ?? canonical.code;
    nameToId.set(norm, id);
  }

  if (unresolvedTtb.length) {
    throw new Error(
      `${campus}: live TTB building codes require explicit source-backed reconciliation:\n` +
        unresolvedTtb
          .map((entry) => `- ${entry.code}: ${entry.name ?? "(TTB name unavailable)"} ${entry.mapUrl ?? ""}`)
          .join("\n"),
    );
  }

  return [...byId.values()].sort(
    (a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.name.localeCompare(b.name),
  );
}

function bboxString(bounds) {
  return `${bounds.minLat},${bounds.minLon},${bounds.maxLat},${bounds.maxLon}`;
}

async function fetchOsmCampus(bounds) {
  const bbox = bboxString(bounds);
  const query = `[out:json][timeout:120];
(
  nwr["building"](${bbox});
  way["highway"~"^(footway|path|pedestrian|steps|living_street)$"](${bbox});
);
out body center geom;`;
  let lastError = null;
  for (const endpoint of OVERPASS_URLS) {
    try {
      const response = await fetchWithRetry(
        endpoint,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: new URLSearchParams({ data: query }),
        },
        `OpenStreetMap Overpass (${new URL(endpoint).hostname})`,
      );
      return response.json();
    } catch (error) {
      lastError = error;
      console.warn(
        `Overpass endpoint ${endpoint} failed; trying next mirror: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `All configured Overpass mirrors failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function osmCenter(element) {
  if (element.center && Number.isFinite(element.center.lon) && Number.isFinite(element.center.lat)) {
    return [element.center.lon, element.center.lat];
  }
  if (Number.isFinite(element.lon) && Number.isFinite(element.lat)) return [element.lon, element.lat];
  const geometry = element.geometry ?? [];
  if (!geometry.length) return null;
  const lons = geometry.map((point) => point.lon);
  const lats = geometry.map((point) => point.lat);
  return [lons.reduce((a, b) => a + b, 0) / lons.length, lats.reduce((a, b) => a + b, 0) / lats.length];
}

function wayPolygon(element) {
  if (element.type !== "way") return null;
  const points = (element.geometry ?? []).map((point) => [point.lon, point.lat]);
  if (points.length < 4) return null;
  const first = points[0];
  const last = points.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return { type: "Polygon", coordinates: [points] };
}

function osmIdentityTokens(element) {
  const tags = element.tags ?? {};
  return stableUnique([tags.name, tags.official_name, tags.alt_name, tags.short_name, tags.ref]).map(normalize);
}

function buildOsmMatches(buildings, elements) {
  const buildingElements = elements.filter((element) => element.tags?.building);
  const matched = new Map();
  for (const building of buildings) {
    const names = recordNames(building).map(normalize);
    const codes = stableUnique([building.code, ...(building.timetableCodes ?? [])]).map(normalize);
    const exact = buildingElements.filter((element) => {
      const tokens = osmIdentityTokens(element);
      return tokens.some((token) => names.includes(token) || codes.includes(token));
    });
    const uniqueRefs = new Map(exact.map((element) => [`${element.type}/${element.id}`, element]));
    const candidates = [...uniqueRefs.values()];
    if (candidates.length === 1) matched.set(building.id, candidates[0]);
    else if (candidates.length > 1) {
      const exactName = candidates.filter((element) => {
        const tags = element.tags ?? {};
        return [tags.name, tags.official_name, tags.alt_name]
          .filter(Boolean)
          .map(normalize)
          .some((token) => names.includes(token));
      });
      if (exactName.length === 1) matched.set(building.id, exactName[0]);
    }
  }
  return matched;
}

async function fetchTorontoOutlines(bounds) {
  const geometry = JSON.stringify({
    xmin: bounds.minLon,
    ymin: bounds.minLat,
    xmax: bounds.maxLon,
    ymax: bounds.maxLat,
    spatialReference: { wkid: 4326 },
  });
  const features = [];
  for (let offset = 0; offset < 20000; offset += 2000) {
    const params = new URLSearchParams({
      where: "1=1",
      geometry,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
      f: "geojson",
      resultOffset: String(offset),
      resultRecordCount: "2000",
    });
    const page = await fetchJson(`${TORONTO_BUILDINGS}?${params}`, {}, "Toronto building outlines");
    const batch = page.features ?? [];
    features.push(...batch);
    if (batch.length < 2000 && !page.exceededTransferLimit) return features;
  }
  throw new Error("Toronto building outline pagination exceeded 20,000 features for one campus.");
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    if (!pointInRing(point, geometry.coordinates[0] ?? [])) return false;
    return geometry.coordinates.slice(1).every((hole) => !pointInRing(point, hole));
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) =>
      pointInGeometry(point, { type: "Polygon", coordinates: polygon }),
    );
  }
  return false;
}

function geometryForMatchedOsm(element, cityFeatures) {
  const osmGeometry = wayPolygon(element);
  if (osmGeometry) {
    return {
      geometry: osmGeometry,
      source: "openstreetmap",
      sourceRef: `${element.type}/${element.id}`,
      method: "exact_identity_match",
    };
  }
  const center = osmCenter(element);
  if (!center) return null;
  const containing = cityFeatures.filter((feature) => pointInGeometry(center, feature.geometry));
  if (containing.length !== 1) return null;
  return {
    geometry: containing[0].geometry,
    source: "toronto-building-outlines",
    sourceRef: String(containing[0].properties?.BUILDINGID ?? containing[0].properties?.OBJECTID ?? containing[0].id ?? ""),
    method: "city_polygon_containing_exact_osm_identity_center",
  };
}

function haversineMeters(a, b) {
  const R = 6371000;
  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const lat1 = rad(a[1]);
  const lat2 = rad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function geometryCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates.flat();
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return [];
}

function makePedestrianGraph(elements) {
  const nodeMap = new Map();
  const edges = [];
  const lineFeatures = [];
  const keyFor = ([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)}`;

  for (const way of elements.filter((element) => element.type === "way" && element.tags?.highway)) {
    const tags = way.tags ?? {};
    if (tags.access === "private" || tags.access === "no") continue;
    const coordinates = (way.geometry ?? []).map((point) => [point.lon, point.lat]);
    if (coordinates.length < 2) continue;
    lineFeatures.push({
      type: "Feature",
      id: `osm-way-${way.id}`,
      properties: {
        osmWayId: way.id,
        highway: tags.highway,
        surface: tags.surface ?? null,
        wheelchair: tags.wheelchair ?? null,
        foot: tags.foot ?? null,
        verificationStatus: "inferred",
        source: "OpenStreetMap",
      },
      geometry: { type: "LineString", coordinates },
    });
    for (const coordinate of coordinates) {
      const key = keyFor(coordinate);
      if (!nodeMap.has(key)) {
        nodeMap.set(key, {
          id: `osm-${key}`,
          longitude: coordinate[0],
          latitude: coordinate[1],
          kind: "path",
          verificationStatus: "inferred",
        });
      }
    }
    for (let index = 1; index < coordinates.length; index += 1) {
      const fromKey = keyFor(coordinates[index - 1]);
      const toKey = keyFor(coordinates[index]);
      if (fromKey === toKey) continue;
      const distanceMeters = haversineMeters(coordinates[index - 1], coordinates[index]);
      edges.push({
        id: `osm-way-${way.id}-${index - 1}`,
        from: nodeMap.get(fromKey).id,
        to: nodeMap.get(toKey).id,
        distanceMeters: Math.round(distanceMeters * 100) / 100,
        bidirectional: tags.oneway !== "yes",
        kind: tags.highway,
        verificationStatus: "inferred",
      });
    }
  }
  return {
    nodes: [...nodeMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
    geojson: { type: "FeatureCollection", features: lineFeatures },
  };
}

function approachForBuilding(geometry, graph) {
  const outlinePoints = geometryCoordinates(geometry);
  if (!outlinePoints.length || !graph.nodes.length) return null;
  let best = null;
  for (const point of outlinePoints) {
    for (const node of graph.nodes) {
      const distanceMeters = haversineMeters(point, [node.longitude, node.latitude]);
      if (!best || distanceMeters < best.distanceMeters) {
        best = { nodeId: node.id, distanceMeters, coordinate: [node.longitude, node.latitude] };
      }
    }
  }
  if (!best || best.distanceMeters > 100) return null;
  return {
    nodeId: best.nodeId,
    longitude: best.coordinate[0],
    latitude: best.coordinate[1],
    distanceFromFootprintMeters: Math.round(best.distanceMeters * 10) / 10,
    verificationStatus: "inferred",
    semantics: "derived-routing-approach",
    notes:
      "Nearest OpenStreetMap pedestrian-network vertex to the mapped building footprint. This is not a verified physical entrance.",
  };
}

function connectedComponents(graph) {
  const adjacent = new Map(graph.nodes.map((node) => [node.id, new Set()]));
  for (const edge of graph.edges) {
    adjacent.get(edge.from)?.add(edge.to);
    adjacent.get(edge.to)?.add(edge.from);
  }
  const seen = new Set();
  const sizes = [];
  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue;
    let size = 0;
    const stack = [node.id];
    seen.add(node.id);
    while (stack.length) {
      const id = stack.pop();
      size += 1;
      for (const next of adjacent.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

async function refreshCampus(campus, sessions, divisions) {
  const config = CAMPUS_CONFIG[campus];
  const source = await readJson(config.sourcePath);
  const inventory = await readJson(config.inventoryPath);
  const aliases = await readJson(config.aliasPath);
  const ttbBuildings = await fetchTtbBuildings(config.label, sessions, divisions);
  const buildings = canonicalizeInventory(campus, inventory, ttbBuildings, aliases);
  const osm = await fetchOsmCampus(source.bounds);
  const osmMatches = buildOsmMatches(buildings, osm.elements ?? []);
  const cityFeatures = await fetchTorontoOutlines(source.bounds);
  const graph = makePedestrianGraph(osm.elements ?? []);

  const footprintFeatures = [];
  const approaches = [];
  const unresolvedGeometry = [];
  for (const building of buildings) {
    const match = osmMatches.get(building.id);
    if (!match) {
      unresolvedGeometry.push({
        id: building.id,
        code: building.code,
        name: building.name,
        reason: "No unique exact OpenStreetMap name/code match in the campus bounds.",
      });
      continue;
    }
    const resolved = geometryForMatchedOsm(match, cityFeatures);
    if (!resolved) {
      unresolvedGeometry.push({
        id: building.id,
        code: building.code,
        name: building.name,
        reason:
          "Exact OpenStreetMap identity match found, but no unambiguous polygon geometry could be derived.",
        osmRef: `${match.type}/${match.id}`,
      });
      continue;
    }
    const approach = approachForBuilding(resolved.geometry, graph);
    if (approach) approaches.push({ buildingId: building.id, ...approach });
    footprintFeatures.push({
      type: "Feature",
      id: building.id,
      properties: {
        campus,
        buildingId: building.id,
        buildingCode: building.code,
        name: building.name,
        timetableCodes: building.timetableCodes,
        facilityCodes: building.facilityCodes,
        geometrySource: resolved.source,
        geometrySourceRef: resolved.sourceRef,
        reconciliationMethod: resolved.method,
        verificationStatus: "inferred",
      },
      geometry: resolved.geometry,
    });
  }

  const timetableCodes = new Map();
  const duplicateTimetableCodes = [];
  for (const building of buildings) {
    for (const code of building.timetableCodes) {
      if (timetableCodes.has(code) && timetableCodes.get(code) !== building.id) {
        duplicateTimetableCodes.push({ code, ids: [timetableCodes.get(code), building.id] });
      } else {
        timetableCodes.set(code, building.id);
      }
    }
  }

  const components = connectedComponents(graph);
  const generatedAt = new Date().toISOString();
  const coverage = {
    campus,
    generatedAt,
    sessions,
    identitySourceCount: inventory.records.filter((record) => record.status !== "demolished").length,
    canonicalBuildingCount: buildings.length,
    timetableBuildingCount: ttbBuildings.length,
    timetableCodeCount: timetableCodes.size,
    geometryResolvedCount: footprintFeatures.length,
    geometryUnresolvedCount: unresolvedGeometry.length,
    routingApproachCount: approaches.length,
    pedestrianNodeCount: graph.nodes.length,
    pedestrianEdgeCount: graph.edges.length,
    pedestrianComponentCount: components.length,
    largestPedestrianComponentNodes: components[0] ?? 0,
    duplicateTimetableCodes,
    unresolvedGeometry,
  };

  const base = `data/${campus}/generated`;
  await writeJson(`${base}/ttb-buildings.json`, {
    campus,
    generatedAt,
    sessions,
    source: "University of Toronto Timetable Builder live service",
    sourceUrl: "https://ttb.utoronto.ca/",
    api: TTB_BASE,
    warning:
      "Observed live service, not a published developer contract. Cached as source evidence; never required at Gapwise runtime.",
    buildings: ttbBuildings,
  });
  await writeJson(`data/${campus}/buildings.json`, {
    campus,
    generatedAt,
    sourceIds: source.identitySources.map((entry) => entry.id),
    buildings,
  });
  await writeJson(`data/${campus}/buildings.geojson`, {
    type: "FeatureCollection",
    name: `Gapwise ${campus.toUpperCase()} building footprints`,
    features: footprintFeatures,
  });
  await writeJson(`${base}/routing-approaches.json`, {
    campus,
    generatedAt,
    semantics:
      "Derived route endpoints only. They are not physical entrance records and must never be displayed as verified entrances.",
    approaches,
  });
  await writeJson(`${base}/pedestrian-network.geojson`, graph.geojson);
  await writeJson(`${base}/routing-graph.json`, {
    campus,
    generatedAt,
    source: "OpenStreetMap",
    verificationStatus: "inferred",
    nodes: graph.nodes,
    edges: graph.edges,
  });
  await writeJson(`${base}/coverage.json`, coverage);
  return coverage;
}

const { sessions, divisions } = await ttbContext();
const reports = {};
for (const campus of Object.keys(CAMPUS_CONFIG)) {
  reports[campus] = await refreshCampus(campus, sessions, divisions);
}
await writeJson("data/tri-campus-coverage.json", {
  generatedAt: new Date().toISOString(),
  sessions,
  campuses: reports,
});
for (const [campus, report] of Object.entries(reports)) {
  console.log(
    `${campus.toUpperCase()}: ${report.canonicalBuildingCount} buildings; ` +
      `${report.geometryResolvedCount} geometries; ${report.routingApproachCount} routing approaches; ` +
      `${report.timetableCodeCount} timetable codes.`,
  );
}
