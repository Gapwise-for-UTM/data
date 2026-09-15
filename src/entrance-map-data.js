import entranceDataRaw from '../data/utm/entrances.geojson?raw';

const footprintModules = import.meta.glob('../data/utm/footprints/*.geojson', {
  eager: true,
  query: '?raw',
  import: 'default',
});

export const SVG_WIDTH = 1000;
export const SVG_HEIGHT = 760;
const CAMPUS_PADDING = 34;

export const footprintFeatures = Object.values(footprintModules)
  .flatMap((raw) => {
    const parsed = JSON.parse(raw);
    return parsed.type === 'FeatureCollection' ? parsed.features : [parsed];
  })
  .filter((feature) => feature?.geometry && feature?.properties?.buildingCode);

export const entranceFeatures = (JSON.parse(entranceDataRaw).features ?? []).filter(
  (feature) => feature?.geometry?.type === 'Point' && feature?.properties?.buildingCode,
);

export function geometryCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.flat();
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
  return [];
}

const allFootprintCoordinates = footprintFeatures.flatMap((feature) =>
  geometryCoordinates(feature.geometry),
);

const campusBounds = allFootprintCoordinates.reduce(
  (bounds, [longitude, latitude]) => ({
    minLon: Math.min(bounds.minLon, longitude),
    maxLon: Math.max(bounds.maxLon, longitude),
    minLat: Math.min(bounds.minLat, latitude),
    maxLat: Math.max(bounds.maxLat, latitude),
  }),
  { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity },
);

const middleLatitude = (campusBounds.minLat + campusBounds.maxLat) / 2;
const longitudeScale = Math.cos((middleLatitude * Math.PI) / 180);
const projectedCampusWidth = (campusBounds.maxLon - campusBounds.minLon) * longitudeScale;
const projectedCampusHeight = campusBounds.maxLat - campusBounds.minLat;
const campusAspect = projectedCampusWidth / projectedCampusHeight;
const canvasAspect = SVG_WIDTH / SVG_HEIGHT;
const contentWidth =
  campusAspect > canvasAspect
    ? SVG_WIDTH - CAMPUS_PADDING * 2
    : (SVG_HEIGHT - CAMPUS_PADDING * 2) * campusAspect;
const contentHeight =
  campusAspect > canvasAspect
    ? contentWidth / campusAspect
    : SVG_HEIGHT - CAMPUS_PADDING * 2;
const originX = (SVG_WIDTH - contentWidth) / 2;
const originY = (SVG_HEIGHT - contentHeight) / 2;

export function project([longitude, latitude]) {
  const xRatio = ((longitude - campusBounds.minLon) * longitudeScale) / projectedCampusWidth;
  const yRatio = (campusBounds.maxLat - latitude) / projectedCampusHeight;
  return [originX + xRatio * contentWidth, originY + yRatio * contentHeight];
}

export function unproject([x, y]) {
  const xRatio = (x - originX) / contentWidth;
  const yRatio = (y - originY) / contentHeight;
  return [
    campusBounds.minLon + (xRatio * projectedCampusWidth) / longitudeScale,
    campusBounds.maxLat - yRatio * projectedCampusHeight,
  ];
}

function pathForRing(ring) {
  return (
    ring
      .map((coordinate, index) => {
        const [x, y] = project(coordinate);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ') + ' Z'
  );
}

export function pathForGeometry(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates.map(pathForRing).join(' ');
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) => polygon.map(pathForRing)).join(' ');
  }
  return '';
}

export const groupedFootprints = footprintFeatures.reduce((grouped, feature) => {
  const code = feature.properties.buildingCode.toUpperCase();
  const records = grouped.get(code) ?? [];
  records.push(feature);
  grouped.set(code, records);
  return grouped;
}, new Map());

export const buildings = [...groupedFootprints.entries()]
  .map(([code, features]) => ({
    code,
    name: features[0]?.properties?.name ?? code,
    category: features[0]?.properties?.category ?? 'facility',
    features,
    entranceCount: entranceFeatures.filter(
      (entrance) => entrance.properties.buildingCode.toUpperCase() === code,
    ).length,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function boundsForFeatures(features, paddingFactor = 0.72) {
  const coordinates = features.flatMap((feature) => geometryCoordinates(feature.geometry));
  const xs = coordinates.map((coordinate) => project(coordinate)[0]);
  const ys = coordinates.map((coordinate) => project(coordinate)[1]);
  if (!xs.length || !ys.length) return { x: 0, y: 0, width: SVG_WIDTH, height: SVG_HEIGHT };
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(85, maxX - minX);
  const height = Math.max(85, maxY - minY);
  const pad = Math.max(width, height) * paddingFactor;
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    width: Math.min(SVG_WIDTH, width + pad * 2),
    height: Math.min(SVG_HEIGHT, height + pad * 2),
  };
}

export function metersBetween([lonA, latA], [lonB, latB]) {
  const radius = 6371000;
  const toRadians = (value) => (value * Math.PI) / 180;
  const phi1 = toRadians(latA);
  const phi2 = toRadians(latB);
  const deltaPhi = toRadians(latB - latA);
  const deltaLambda = toRadians(lonB - lonA);
  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function todayLocalDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}
