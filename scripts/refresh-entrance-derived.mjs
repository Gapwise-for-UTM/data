import { distanceMeters, entranceInputIssues, nodeId } from "./lib/entrance-contract.mjs";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = resolve(root, "data/utm");
const load = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const writeJson = async (path, value, pretty = true) =>
  writeFile(resolve(root, path), JSON.stringify(value, null, pretty ? 2 : 0) + "\n", "utf8");

const [entrances, nodesDoc, edgesDoc, accessAudit, entranceAudit, snapshot] = await Promise.all([
  load("data/utm/entrances.geojson"),
  load("data/utm/outdoor-nodes.geojson"),
  load("data/utm/outdoor-edges.json"),
  load("data/utm/generated/campus-access-audit.json"),
  load("data/utm/generated/entrance-audit.geojson"),
  load("public/data/utm-campus-v1.json"),
]);

const inputIssues = entranceInputIssues({ entrances, nodesDoc, edgesDoc, accessAudit, snapshot });
if (inputIssues.length) throw new Error(`Cannot derive entrance data:\n- ${inputIssues.join("\n- ")}`);

function auditFeature(feature) {
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

const nodes = new Map(nodesDoc.features.map((f) => [f.id, f]));
const movedNodes = new Set();
const entranceNodeIds = new Set(entrances.features.map(nodeId));

for (const feature of entrances.features) {
  const id = nodeId(feature);
  if (!id) throw new Error(`${feature.id}: add routingNodeId or osmNodeId before deriving`);
  const node = nodes.get(id);
  if (!node) throw new Error(`${feature.id}: routing node ${id} does not exist`);

  if (JSON.stringify(node.geometry.coordinates) !== JSON.stringify(feature.geometry.coordinates)) {
    node.geometry.coordinates = [...feature.geometry.coordinates];
    movedNodes.add(id);
  }
  node.properties.kind = "building-entrance";
  node.properties.buildingCode = feature.properties.buildingCode;
  if (node.properties.floor === undefined) node.properties.floor = null;
  node.properties.accessibility = feature.properties.accessibility ?? "unknown";
  node.properties.label = feature.properties.label;
  // Core overlays canonical entrance semantics while assembling the graph.
  // Remove legacy graph overrides so access and direction have one owner.
  delete node.properties.access;
  delete node.properties.direction;
  if (feature.properties.notes) node.properties.notes = feature.properties.notes;
  else delete node.properties.notes;
  node.properties.metadata = {
    source: feature.properties.source,
    sourceUrl: feature.properties.sourceUrl,
    lastVerified: feature.properties.lastVerified,
    verificationStatus: feature.properties.verificationStatus,
  };
}

for (const edge of edgesDoc.edges) {
  if (!entranceNodeIds.has(edge.from) && !entranceNodeIds.has(edge.to)) continue;
  const from = nodes.get(edge.from)?.geometry?.coordinates;
  const to = nodes.get(edge.to)?.geometry?.coordinates;
  if (!from || !to) throw new Error(`${edge.id}: missing graph endpoint`);
  const expectedDistance = distanceMeters(from, to);
  // Preserve existing floating-point bytes when only rounding differs.
  if (movedNodes.has(edge.from) || movedNodes.has(edge.to) ||
      !Number.isFinite(edge.distanceMeters) || Math.abs(edge.distanceMeters - expectedDistance) > 1e-6) {
    edge.distanceMeters = expectedDistance;
  }
}

entranceAudit.features = [
  ...entrances.features.map(auditFeature),
  ...entranceAudit.features.filter((f) => f.properties?.routability !== "routable"),
];

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

const byBuilding = new Map();
for (const feature of entrances.features) {
  const code = feature.properties.buildingCode;
  if (!byBuilding.has(code)) byBuilding.set(code, []);
  byBuilding.get(code).push(feature);
}
for (const audit of accessAudit.buildings) {
  const features = byBuilding.get(audit.code) ?? [];
  const ids = features.map(nodeId).filter(Boolean);
  audit.verifiedExteriorEntrances = features.filter(
    (f) => f.properties.kind === "entrance" && f.properties.verificationStatus === "verified",
  ).length;
  audit.inferredApproaches = features.filter((f) => f.properties.kind === "approach").length;
  audit.graphConnectedAccessPoints = ids.filter((id) => (incident.get(id) ?? 0) > 0).length;
  audit.mainCampusComponentAccessPoints = ids.filter((id) => mainComponent.has(id)).length;
  audit.verifiedAccessibleEntrances = features.filter(
    (f) =>
      f.properties.kind === "entrance" &&
      f.properties.verificationStatus === "verified" &&
      f.properties.accessibility === "accessible",
  ).length;
}
for (const building of snapshot.buildings) {
  const features = byBuilding.get(building.code) ?? [];
  building.entranceCount = features.length;
  building.verifiedEntranceCount = features.filter(
    (f) => f.properties.verificationStatus === "verified",
  ).length;
  building.routingCoverage = features.length > 0 ? "mapped" : "identity-only";
}

await writeJson("data/utm/outdoor-nodes.geojson", nodesDoc, false);
await writeJson("data/utm/outdoor-edges.json", edgesDoc, false);
await writeJson("data/utm/generated/campus-access-audit.json", accessAudit, true);
await writeJson("data/utm/generated/entrance-audit.geojson", entranceAudit, true);
await writeJson("public/data/utm-campus-v1.json", snapshot, false);

async function filesUnder(dir) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) {
        const path = relative(dir, absolute).replaceAll("\\", "/");
        if (path !== "SHA256SUMS") files.push(path);
      }
    }
  }
  await visit(dir);
  return files.sort();
}
const lines = [];
for (const path of await filesUnder(dataRoot)) {
  const digest = createHash("sha256")
    .update(await readFile(resolve(dataRoot, path)))
    .digest("hex");
  lines.push(`${digest}  ${path}`);
}
await writeFile(resolve(dataRoot, "SHA256SUMS"), lines.join("\n") + "\n", "utf8");

console.log(
  `Derived entrance data from ${entrances.features.length} canonical access points; ${movedNodes.size} routing-node coordinate(s) refreshed.`,
);
