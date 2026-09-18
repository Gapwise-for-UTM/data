import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const campuses = ["utsg", "utsc"];

const fail = (message) => {
  console.error(`tri-campus validation failed: ${message}`);
  process.exit(1);
};

async function readJson(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) fail(`missing ${path}`);
  try {
    return JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const campus of campuses) {
  const source = await readJson(`data/${campus}/source.json`);
  const registry = await readJson(`data/${campus}/buildings.json`);
  const footprints = await readJson(`data/${campus}/buildings.geojson`);
  const ttb = await readJson(`data/${campus}/generated/ttb-buildings.json`);
  const aliases = await readJson(`data/${campus}/sources/reconciliation-aliases.json`);
  const approaches = await readJson(`data/${campus}/generated/routing-approaches.json`);
  const graph = await readJson(`data/${campus}/generated/routing-graph.json`);
  const coverage = await readJson(`data/${campus}/generated/coverage.json`);

  if (source.campus !== campus) fail(`${campus}: source campus mismatch`);
  if (!source.bounds || !(source.bounds.minLon < source.bounds.maxLon) || !(source.bounds.minLat < source.bounds.maxLat)) {
    fail(`${campus}: invalid campus bounds`);
  }
  if (!Array.isArray(registry.buildings) || !registry.buildings.length) fail(`${campus}: empty building registry`);
  if (footprints.type !== "FeatureCollection" || !Array.isArray(footprints.features)) {
    fail(`${campus}: buildings.geojson must be a FeatureCollection`);
  }
  if (!Array.isArray(ttb.buildings) || !ttb.buildings.length) fail(`${campus}: live TTB evidence is empty`);
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !graph.nodes.length) {
    fail(`${campus}: pedestrian routing graph is empty`);
  }

  const ids = new Set();
  const timetableCodes = new Map();
  for (const building of registry.buildings) {
    if (!building.id || !building.name || !building.code) fail(`${campus}: building missing id/name/code`);
    if (building.campus !== campus) fail(`${campus}: ${building.id} campus mismatch`);
    if (ids.has(building.id)) fail(`${campus}: duplicate building id ${building.id}`);
    ids.add(building.id);
    for (const code of building.timetableCodes ?? []) {
      const normalized = String(code).trim().toUpperCase();
      if (!normalized) fail(`${campus}: blank timetable code on ${building.id}`);
      const existing = timetableCodes.get(normalized);
      if (existing && existing !== building.id) {
        fail(`${campus}: timetable code ${normalized} maps to both ${existing} and ${building.id}`);
      }
      timetableCodes.set(normalized, building.id);
    }
  }

  const featureIds = new Set();
  for (const feature of footprints.features) {
    const id = feature.properties?.buildingId ?? feature.id;
    if (!ids.has(id)) fail(`${campus}: footprint references unknown building ${id}`);
    if (featureIds.has(id)) fail(`${campus}: duplicate footprint for ${id}`);
    featureIds.add(id);
    if (!["Polygon", "MultiPolygon"].includes(feature.geometry?.type)) {
      fail(`${campus}: ${id} has unsupported footprint geometry ${feature.geometry?.type}`);
    }
    if (!["openstreetmap", "toronto-building-outlines"].includes(feature.properties?.geometrySource)) {
      fail(`${campus}: ${id} has unknown geometry source`);
    }
    if (feature.properties?.verificationStatus !== "inferred") {
      fail(`${campus}: imported geometry must remain explicitly inferred until independently verified`);
    }
  }

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  if (nodeIds.size !== graph.nodes.length) fail(`${campus}: duplicate routing node ids`);
  const edgeIds = new Set();
  for (const edge of graph.edges) {
    if (!edge.id || edgeIds.has(edge.id)) fail(`${campus}: duplicate/blank routing edge id ${edge.id}`);
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      fail(`${campus}: routing edge ${edge.id} references missing node`);
    }
    if (!(edge.distanceMeters > 0)) fail(`${campus}: routing edge ${edge.id} has invalid distance`);
  }

  const approachBuildings = new Set();
  for (const approach of approaches.approaches ?? []) {
    if (!ids.has(approach.buildingId)) fail(`${campus}: approach references unknown building ${approach.buildingId}`);
    if (!nodeIds.has(approach.nodeId)) fail(`${campus}: approach references missing routing node ${approach.nodeId}`);
    if (approach.semantics !== "derived-routing-approach") {
      fail(`${campus}: approach ${approach.buildingId} is not explicitly derived`);
    }
    if (approach.verificationStatus !== "inferred") {
      fail(`${campus}: approach ${approach.buildingId} must remain inferred`);
    }
    if (approachBuildings.has(approach.buildingId)) fail(`${campus}: duplicate routing approach`);
    approachBuildings.add(approach.buildingId);
  }

  if (coverage.canonicalBuildingCount !== registry.buildings.length) {
    fail(`${campus}: coverage canonicalBuildingCount drift`);
  }
  if (coverage.timetableBuildingCount !== ttb.buildings.length) {
    fail(`${campus}: coverage timetableBuildingCount drift`);
  }
  if (coverage.geometryResolvedCount !== footprints.features.length) {
    fail(`${campus}: coverage geometryResolvedCount drift`);
  }
  if (coverage.routingApproachCount !== (approaches.approaches ?? []).length) {
    fail(`${campus}: coverage routingApproachCount drift`);
  }
  if ((coverage.duplicateTimetableCodes ?? []).length) {
    fail(`${campus}: duplicate timetable-code mappings remain unresolved`);
  }

  const excludedCodes = new Set([
    ...Object.keys(aliases.nonPhysicalCodes ?? {}),
    ...Object.keys(aliases.excludedTimetableCodes ?? {}),
  ].map((code) => code.toUpperCase()));
  for (const ttbBuilding of ttb.buildings) {
    const code = String(ttbBuilding.code ?? "").toUpperCase();
    if (excludedCodes.has(code)) continue;
    if (!timetableCodes.has(code)) {
      fail(`${campus}: live TTB building code ${code} has no canonical identity`);
    }
  }

  console.log(
    `Validated ${campus.toUpperCase()}: ${registry.buildings.length} identities, ` +
      `${footprints.features.length} mapped geometries, ${approachBuildings.size} derived approaches, ` +
      `${timetableCodes.size} timetable codes.`,
  );
}
