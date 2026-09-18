// Shared input invariants for derivation and verification. This module performs no I/O.
export function nodeId(feature) {
  if (feature.properties.routingNodeId?.trim()) return feature.properties.routingNodeId.trim();
  return feature.properties.osmNodeId === undefined ? null : `osm-node-${feature.properties.osmNodeId}`;
}

export function distanceMeters(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const q = Math.sin(rad(b[1] - a[1]) / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(q));
}

export function entranceInputIssues({ entrances, nodesDoc, edgesDoc, accessAudit, snapshot }) {
  const issues = [];
  const unique = (records, key, label) => {
    const seen = new Set();
    for (const record of records) {
      const id = record[key];
      if (typeof id !== "string" || !id.trim()) issues.push(`${label}: missing ${key}`);
      if (seen.has(id)) issues.push(`${label}: duplicate ${key} ${id}`);
      seen.add(id);
    }
    return seen;
  };
  unique(entrances.features, "id", "entrances.geojson");
  const nodeIds = unique(nodesDoc.features, "id", "outdoor-nodes.geojson");
  unique(edgesDoc.edges, "id", "outdoor-edges.json");
  const buildingCodes = unique(snapshot.buildings, "code", "public snapshot");
  const auditCodes = unique(accessAudit.buildings, "code", "campus-access-audit.json");
  const claimedNodes = new Set();
  const preferred = new Set();
  const incident = new Set(edgesDoc.edges.flatMap((edge) => [edge.from, edge.to]));
  for (const edge of edgesDoc.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) issues.push(`${edge.id}: missing graph endpoint`);
  }
  for (const feature of entrances.features) {
    const properties = feature.properties;
    const code = properties.buildingCode;
    if (!buildingCodes.has(code)) issues.push(`${feature.id}: unknown public building ${code}`);
    if (!auditCodes.has(code)) issues.push(`${feature.id}: missing campus-access-audit row for ${code}`);
    const coordinates = feature.geometry?.coordinates;
    if (feature.geometry?.type !== "Point" || !Array.isArray(coordinates) || coordinates.length !== 2 ||
        !coordinates.every(Number.isFinite) || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) {
      issues.push(`${feature.id}: expected finite WGS84 Point [longitude, latitude]`);
    }
    const id = nodeId(feature);
    if (!id || !nodeIds.has(id)) issues.push(`${feature.id}: routing node ${id ?? "(missing)"} does not exist`);
    if (id && claimedNodes.has(id)) issues.push(`${feature.id}: routing node ${id} is claimed by multiple entrances`);
    claimedNodes.add(id);
    if (id && !incident.has(id)) issues.push(`${feature.id}: routing node ${id} has no graph edge`);
    if (properties.preferredForRouting === true) {
      if (preferred.has(code)) issues.push(`${code}: more than one preferred routing entrance`);
      preferred.add(code);
    }
    // Match the core consumer's fail-closed non-OSM provenance requirements.
    if (properties.osmNodeId === undefined &&
        (!properties.verificationMethod?.trim() || !properties.sourceIdentifier?.trim())) {
      issues.push(`${feature.id}: non-OSM entrances require verificationMethod and sourceIdentifier`);
    }
  }
  for (const node of nodesDoc.features) {
    if (node.properties.kind === "building-entrance" && !claimedNodes.has(node.id)) {
      issues.push(`${node.id}: removed entrance still has a building-entrance graph node; review its graph role/connectivity before deriving`);
    }
  }
  return issues;
}
