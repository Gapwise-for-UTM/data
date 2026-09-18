import {
  buildings as utmBuildings,
  entranceFeatures as utmEntranceFeatures,
  footprintFeatures as utmFootprintFeatures,
  geometryCoordinates,
  metersBetween,
  todayLocalDate,
} from './entrance-map-data.js';
import utsgRegistry from '../data/utsg/buildings.json';
import utsgFootprints from '../data/utsg/buildings.geojson';
import utscRegistry from '../data/utsc/buildings.json';
import utscFootprints from '../data/utsc/buildings.geojson';

export const MAP_WIDTH = 1200;
export const MAP_HEIGHT = 840;
const MAP_PADDING = 26;

function boundsFromFeatures(features, fallback) {
  const coordinates = features.flatMap((feature) => geometryCoordinates(feature.geometry));
  if (!coordinates.length) return fallback;
  const lons = coordinates.map(([lon]) => lon);
  const lats = coordinates.map(([, lat]) => lat);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lonPad = Math.max((maxLon - minLon) * 0.09, 0.0007);
  const latPad = Math.max((maxLat - minLat) * 0.09, 0.0005);
  return {
    minLon: minLon - lonPad,
    maxLon: maxLon + lonPad,
    minLat: minLat - latPad,
    maxLat: maxLat + latPad,
  };
}

const UTM_FALLBACK = {
  minLon: -79.6755,
  maxLon: -79.6542,
  minLat: 43.5421,
  maxLat: 43.5577,
};

const UTSG_FALLBACK = {
  minLon: -79.4215,
  maxLon: -79.3650,
  minLat: 43.6450,
  maxLat: 43.6825,
};

const UTSC_FALLBACK = {
  minLon: -79.2050,
  maxLon: -79.1650,
  minLat: 43.7720,
  maxLat: 43.7995,
};

const TRI_CAMPUS_REGISTRIES = {
  utsg: utsgRegistry,
  utsc: utscRegistry,
};

const TRI_CAMPUS_FOOTPRINTS = {
  utsg: Array.isArray(utsgFootprints?.features) ? utsgFootprints.features : [],
  utsc: Array.isArray(utscFootprints?.features) ? utscFootprints.features : [],
};

function importedBuildingsForCampus(campusId) {
  const registry = TRI_CAMPUS_REGISTRIES[campusId];
  const footprints = TRI_CAMPUS_FOOTPRINTS[campusId] ?? [];
  if (!registry?.buildings) return [];

  const featuresByBuildingId = new Map();
  for (const feature of footprints) {
    const buildingId = feature?.properties?.buildingId ?? feature?.id;
    if (!buildingId) continue;
    const current = featuresByBuildingId.get(buildingId) ?? [];
    current.push(feature);
    featuresByBuildingId.set(buildingId, current);
  }

  return registry.buildings.map((building) => ({
    code: building.code,
    name: building.name,
    aliases: building.aliases ?? [],
    timetableCodes: building.timetableCodes ?? [],
    campus: campusId,
    source: 'canonical',
    canonicalId: building.id,
    features: featuresByBuildingId.get(building.id) ?? [],
    entranceCount: 0,
    geometryStatus: featuresByBuildingId.has(building.id) ? 'mapped' : 'unresolved',
  }));
}

export const CAMPUSES = {
  utm: {
    id: 'utm',
    shortName: 'UTM',
    name: 'University of Toronto Mississauga',
    bounds: boundsFromFeatures(utmFootprintFeatures, UTM_FALLBACK),
    tileZoom: 17,
  },
  utsg: {
    id: 'utsg',
    shortName: 'UTSG',
    name: 'University of Toronto St. George',
    bounds: boundsFromFeatures(TRI_CAMPUS_FOOTPRINTS.utsg, UTSG_FALLBACK),
    tileZoom: 16,
  },
  utsc: {
    id: 'utsc',
    shortName: 'UTSC',
    name: 'University of Toronto Scarborough',
    bounds: boundsFromFeatures(TRI_CAMPUS_FOOTPRINTS.utsc, UTSC_FALLBACK),
    tileZoom: 16,
  },
};

export const CAMPUS_IDS = Object.keys(CAMPUSES);

export function campusFromQuery() {
  const requested = new URLSearchParams(window.location.search).get('campus')?.toLowerCase();
  return CAMPUSES[requested] ? requested : 'utm';
}

export function canonicalBuildingsForCampus(campusId) {
  if (campusId === 'utm') {
    return utmBuildings.map((building) => ({ ...building, source: 'canonical', campus: 'utm' }));
  }
  if (campusId === 'utsg' || campusId === 'utsc') {
    return importedBuildingsForCampus(campusId);
  }
  return [];
}

export function canonicalFootprintsForCampus(campusId) {
  if (campusId === 'utm') return utmFootprintFeatures;
  return TRI_CAMPUS_FOOTPRINTS[campusId] ?? [];
}

export function canonicalEntrancesForCampus(campusId) {
  return campusId === 'utm' ? utmEntranceFeatures : [];
}

export function createCampusProjection(campusId) {
  const campus = CAMPUSES[campusId] ?? CAMPUSES.utm;
  const { bounds } = campus;
  const middleLatitude = (bounds.minLat + bounds.maxLat) / 2;
  const longitudeScale = Math.cos((middleLatitude * Math.PI) / 180);
  const projectedWidth = (bounds.maxLon - bounds.minLon) * longitudeScale;
  const projectedHeight = bounds.maxLat - bounds.minLat;
  const canvasWidth = MAP_WIDTH - MAP_PADDING * 2;
  const canvasHeight = MAP_HEIGHT - MAP_PADDING * 2;
  const campusAspect = projectedWidth / projectedHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  const contentWidth = campusAspect > canvasAspect ? canvasWidth : canvasHeight * campusAspect;
  const contentHeight = campusAspect > canvasAspect ? canvasWidth / campusAspect : canvasHeight;
  const originX = (MAP_WIDTH - contentWidth) / 2;
  const originY = (MAP_HEIGHT - contentHeight) / 2;

  function project([longitude, latitude]) {
    const xRatio = ((longitude - bounds.minLon) * longitudeScale) / projectedWidth;
    const yRatio = (bounds.maxLat - latitude) / projectedHeight;
    return [originX + xRatio * contentWidth, originY + yRatio * contentHeight];
  }

  function unproject([x, y]) {
    const xRatio = (x - originX) / contentWidth;
    const yRatio = (y - originY) / contentHeight;
    return [
      bounds.minLon + (xRatio * projectedWidth) / longitudeScale,
      bounds.maxLat - yRatio * projectedHeight,
    ];
  }

  return { campus, project, unproject, originX, originY, contentWidth, contentHeight };
}

function ringPath(ring, project) {
  return ring
    .map((coordinate, index) => {
      const [x, y] = project(coordinate);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ') + ' Z';
}

export function geometryPath(geometry, project) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') return geometry.coordinates.map((ring) => ringPath(ring, project)).join(' ');
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) => polygon.map((ring) => ringPath(ring, project))).join(' ');
  }
  if (geometry.type === 'LineString') {
    return geometry.coordinates
      .map((coordinate, index) => {
        const [x, y] = project(coordinate);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }
  return '';
}

export function geometryBounds(geometry, project, paddingFactor = 0.75) {
  let coordinates = [];
  if (geometry?.type === 'Polygon') coordinates = geometry.coordinates.flat();
  if (geometry?.type === 'MultiPolygon') coordinates = geometry.coordinates.flat(2);
  if (geometry?.type === 'LineString') coordinates = geometry.coordinates;
  if (geometry?.type === 'Point') coordinates = [geometry.coordinates];
  if (!coordinates.length) return { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT };
  const points = coordinates.map(project);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rawWidth = Math.max(80, maxX - minX);
  const rawHeight = Math.max(80, maxY - minY);
  const pad = Math.max(rawWidth, rawHeight) * paddingFactor;
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    width: Math.min(MAP_WIDTH, rawWidth + pad * 2),
    height: Math.min(MAP_HEIGHT, rawHeight + pad * 2),
  };
}

export function featureCenter(feature) {
  const coordinates = geometryCoordinates(feature?.geometry);
  if (!coordinates.length) return null;
  const sum = coordinates.reduce(
    (acc, [lon, lat]) => [acc[0] + lon, acc[1] + lat],
    [0, 0],
  );
  return [sum[0] / coordinates.length, sum[1] / coordinates.length];
}

function lonToTileX(lon, zoom) {
  return ((lon + 180) / 360) * 2 ** zoom;
}

function latToTileY(lat, zoom) {
  const radians = (lat * Math.PI) / 180;
  return (
    (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2
  ) * 2 ** zoom;
}

function tileXToLon(x, zoom) {
  return (x / 2 ** zoom) * 360 - 180;
}

function tileYToLat(y, zoom) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function tilesForCampus(campusId, project) {
  const campus = CAMPUSES[campusId] ?? CAMPUSES.utm;
  const zoom = campus.tileZoom;
  const { minLon, maxLon, minLat, maxLat } = campus.bounds;
  const minX = Math.floor(lonToTileX(minLon, zoom));
  const maxX = Math.floor(lonToTileX(maxLon, zoom));
  const minY = Math.floor(latToTileY(maxLat, zoom));
  const maxY = Math.floor(latToTileY(minLat, zoom));
  const tiles = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const west = tileXToLon(x, zoom);
      const east = tileXToLon(x + 1, zoom);
      const north = tileYToLat(y, zoom);
      const south = tileYToLat(y + 1, zoom);
      const [left, top] = project([west, north]);
      const [right, bottom] = project([east, south]);
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        href: `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      });
    }
  }
  return tiles;
}

export function makeId(prefix = 'draft') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export { metersBetween, todayLocalDate };
