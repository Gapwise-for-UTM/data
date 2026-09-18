import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

const [entrances, nodesDoc, edgesDoc, accessAudit, entranceAudit, snapshot] = await Promise.all([
  load("data/utm/entrances.geojson"),
  load("data/utm/outdoor-nodes.geojson"),
  load("data/utm/outdoor-edges.json"),
  load("data/utm/generated/campus-access-audit.json"),
  load("data/utm/generated/entrance-audit.geojson"),
  load("public/data/utm-campus-v1.json"),
]);

const issues = [];
const nodes = new Map(nodesDoc.features.map((f) => [f.id, f]));
const incident = new Map(nodesDoc.features.map((f) => [f.id, 0]));
const adjacency = new Map(nodesDoc.features.map((f) => [f.id, []]));

for (const edge of edgesDoc.edges) {
  if (incident.has(edge.from)) incident.set(edge.from, incident.get(edge.from) + 1);
  if (incident.has(edge.to)) incident.set(edge.to, incident.get(edge.to) + 1);
  if (adjacency.has(edge.from) && adjacency.has(edge.to)) {
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }
}

const seen = new Set();
let mainComponent = new Set();
for (const id of adjacency.keys()) {
  if (seen.has(id)) continue;
  const component = new Set();
  const stack = [id];
  seen.add(id);
  while (stack.length) {
    const current = stack.pop();
    component.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  if (component.size > mainComponent.size) mainComponent = component;
}

function nodeId(feature) {
  if (feature.properties.routingNodeId?.trim()) return feature.properties.routingNodeId.trim();
  return feature.properties.osmNodeId === undefined
    ? null
    : `osm-node-${feature.properties.osmNodeId}`;
}

function expectedAudit(feature) {
  return {
    type: "Feature",
    id: feature.id,
    geometry: feature.geometry,
    properties: {
      buildingCode: feature.properties.buildingCode,
      label: feature.properties.label,
      kind: feature.properties.kind === "approach" ? "pedestrian_approach" : "exterior_entrance",
      routability: "routable",
      publicAccess:
        feature.properties.access === "restricted" ||
        feature.properties.access === "emergency_only"
          ? "restricted"
          : "unknown",
      barrierFree: feature.properties.accessibility === "accessible" ? "verified" : "unknown",
      geometryConfidence: feature.properties.kind === "approach" ? "inferred" : "mapped",
      reconciliation: null,
    },
  };
}

const auditById = new Map(
  entranceAudit.features
    .filter((f) => f.properties?.routability === "routable")
    .map((f) => [f.id, f]),
);
const byBuilding = new Map();

for (const feature of entrances.features) {
  const code = feature.properties.buildingCode;
  if (!byBuilding.has(code)) byBuilding.set(code, []);
  byBuilding.get(code).push(feature);

  const id = nodeId(feature);
  const node = id ? nodes.get(id) : null;
  if (!id) issues.push(`${feature.id}: missing routingNodeId/osmNodeId`);
  else if (!node) issues.push(`${feature.id}: routing node ${id} is missing`);
  else {
    if (node.properties?.kind !== "building-entrance") {
      issues.push(`${feature.id}: ${id} is not a building-entrance node`);
    }
    if (node.properties?.buildingCode !== code) {
      issues.push(`${feature.id}: ${id} is attached to the wrong building`);
    }
    if (JSON.stringify(node.geometry?.coordinates) !== JSON.stringify(feature.geometry?.coordinates)) {
      issues.push(`${feature.id}: routing-node coordinates drifted from entrances.geojson`);
    }
    if ((incident.get(id) ?? 0) === 0) issues.push(`${feature.id}: routing node has no graph edge`);
  }

  const audit = auditById.get(feature.id);
  if (!audit) issues.push(`${feature.id}: missing generated entrance-audit record`);
  else if (JSON.stringify(audit) !== JSON.stringify(expectedAudit(feature))) {
    issues.push(`${feature.id}: generated entrance-audit record is stale`);
  }
}

for (const [code, features] of byBuilding) {
  if (features.filter((f) => f.properties.preferredForRouting === true).length > 1) {
    issues.push(`${code}: more than one preferred routing entrance`);
  }
}

const auditByCode = new Map(accessAudit.buildings.map((b) => [b.code, b]));
for (const building of snapshot.buildings) {
  const features = byBuilding.get(building.code) ?? [];
  const verified = features.filter((f) => f.properties.verificationStatus === "verified").length;
  if (building.entranceCount !== features.length) {
    issues.push(`${building.code}: snapshot entranceCount=${building.entranceCount}, canonical=${features.length}`);
  }
  if (building.verifiedEntranceCount !== verified) {
    issues.push(`${building.code}: snapshot verifiedEntranceCount=${building.verifiedEntranceCount}, canonical=${verified}`);
  }
  if (features.length > 0 && building.routingCoverage !== "mapped") {
    issues.push(`${building.code}: mapped access exists but routingCoverage=${building.routingCoverage}`);
  }
}

for (const [code, features] of byBuilding) {
  const audit = auditByCode.get(code);
  if (!audit) {
    issues.push(`${code}: missing campus-access-audit row`);
    continue;
  }
  const ids = features.map(nodeId).filter(Boolean);
  const expected = {
    verifiedExteriorEntrances: features.filter(
      (f) => f.properties.kind === "entrance" && f.properties.verificationStatus === "verified",
    ).length,
    inferredApproaches: features.filter((f) => f.properties.kind === "approach").length,
    graphConnectedAccessPoints: ids.filter((id) => (incident.get(id) ?? 0) > 0).length,
    mainCampusComponentAccessPoints: ids.filter((id) => mainComponent.has(id)).length,
    verifiedAccessibleEntrances: features.filter(
      (f) =>
        f.properties.kind === "entrance" &&
        f.properties.verificationStatus === "verified" &&
        f.properties.accessibility === "accessible",
    ).length,
  };
  for (const [field, value] of Object.entries(expected)) {
    if (audit[field] !== value) {
      issues.push(`${code}: campus-access-audit ${field}=${audit[field]}, canonical=${value}`);
    }
  }
}

if (issues.length) {
  console.error(`Entrance coherence check failed with ${issues.length} issue(s):`);
  for (const issue of issues) console.error(`- ${issue}`);
  console.error("\nRun `npm run entrances:derive` after changing canonical entrance data.");
  process.exit(1);
}
console.log(`Entrance coherence OK: ${entrances.features.length} access points.`);
