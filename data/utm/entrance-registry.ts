import type { AccessibilityStatus } from "@/features/routing/types";
import { UTM_BUILDINGS } from "./building-registry";
import entranceDataRaw from "./entrances.geojson?raw";
import {
  OFFICIAL_BARRIER_FREE_ENTRANCE_CANDIDATES,
  type OfficialEntranceCandidate,
} from "./official-entrance-candidates";
import { factEvidence, type FactEvidence } from "./provenance";

export type EntranceGeometryConfidence =
  "field_verified" | "official" | "mapped" | "inferred" | "unknown";
export type EntranceFactState = "verified" | "restricted" | "unknown";
export type EntranceDirection = "bidirectional" | "entry_only" | "exit_only" | "unknown";
export type EntranceRegistryRecord = {
  id: string;
  buildingCode: string;
  label: string;
  kind: "exterior_entrance" | "building_connection" | "pedestrian_approach";
  coordinates?: [number, number];
  routingNodeId?: string;
  routability: "routable" | "candidate" | "non_routable";
  publicAccess: EntranceFactState;
  direction: EntranceDirection;
  barrierFree: "verified" | "not_barrier_free" | "unknown";
  geometryConfidence: EntranceGeometryConfidence;
  officialReconciliation?: OfficialEntranceCandidate["reconciliationStatus"];
  evidence: {
    existence: FactEvidence;
    geometry: FactEvidence;
    publicAccess: FactEvidence;
    direction: FactEvidence;
    barrierFree: FactEvidence;
  };
};

type Feature = {
  id: string;
  geometry: { coordinates: [number, number] };
  properties: {
    buildingCode: string;
    label: string;
    kind: "entrance" | "approach";
    osmNodeId?: number;
    routingNodeId?: string;
    accessibility: AccessibilityStatus;
    access?: "public" | "restricted" | "emergency_only" | "unknown";
    direction?: EntranceDirection;
    verificationStatus: "verified" | "inferred";
  };
};

const features = (JSON.parse(entranceDataRaw) as { features: Feature[] }).features;
const unknown = (note: string) => factEvidence(["openstreetmap"], "unknown", note);

const geocoded: EntranceRegistryRecord[] = features.map((feature) => {
  const { properties } = feature;
  const inferred = properties.kind === "approach" || properties.verificationStatus === "inferred";
  const routingNodeId =
    properties.routingNodeId ??
    (properties.osmNodeId === undefined ? undefined : `osm-node-${properties.osmNodeId}`);
  const direction = properties.direction ?? "unknown";
  return {
    id: feature.id,
    buildingCode: properties.buildingCode,
    label: properties.label,
    kind: inferred ? "pedestrian_approach" : "exterior_entrance",
    coordinates: feature.geometry.coordinates,
    ...(routingNodeId ? { routingNodeId } : {}),
    routability: routingNodeId ? "routable" : "candidate",
    publicAccess:
      properties.access === "public"
        ? "verified"
        : properties.access === "restricted" || properties.access === "emergency_only"
          ? "restricted"
          : "unknown",
    direction,
    barrierFree:
      properties.accessibility === "accessible"
        ? "verified"
        : properties.accessibility === "not_accessible"
          ? "not_barrier_free"
          : "unknown",
    geometryConfidence: inferred ? "inferred" : "mapped",
    evidence: {
      existence: factEvidence(
        ["openstreetmap"],
        inferred ? "approximate" : "verified",
        inferred
          ? "A pedestrian topology point is not evidence of a physical door."
          : "An OSM entrance-tagged node establishes a mapped door and building association.",
      ),
      geometry: factEvidence(["openstreetmap"], inferred ? "approximate" : "verified"),
      publicAccess:
        properties.access === "public"
          ? factEvidence(["openstreetmap"], "verified")
          : properties.access === "restricted"
            ? factEvidence(
                ["openstreetmap"],
                "verified",
                "Reviewed OSM access metadata explicitly restricts ordinary public/student access.",
              )
            : properties.access === "emergency_only"
              ? factEvidence(
                  ["openstreetmap"],
                  "verified",
                  "Reviewed OSM entrance metadata explicitly limits this door to emergency use.",
                )
              : unknown("No reviewed source establishes ordinary public/student access."),
      direction:
        direction === "unknown"
          ? unknown("No reviewed source establishes entry/exit direction restrictions for this entrance.")
          : factEvidence(
              ["openstreetmap"],
              "verified",
              "Reviewed source metadata explicitly establishes this entrance direction restriction.",
            ),
      barrierFree:
        properties.accessibility === "accessible"
          ? factEvidence(
              ["openstreetmap"],
              "verified",
              "Reviewed OSM accessibility metadata; connecting edges must independently pass step-free checks.",
            )
          : unknown("No reviewed source establishes barrier-free suitability for this coordinate."),
    },
  };
});

const candidates: EntranceRegistryRecord[] = OFFICIAL_BARRIER_FREE_ENTRANCE_CANDIDATES.map(
  (candidate) => ({
    id: candidate.id,
    buildingCode: candidate.buildingCode,
    label: candidate.label,
    kind: candidate.kind,
    ...(candidate.coordinates ? { coordinates: candidate.coordinates } : {}),
    ...(candidate.routingNodeId ? { routingNodeId: candidate.routingNodeId } : {}),
    routability: candidate.routingStatus,
    publicAccess: "unknown",
    direction: "unknown",
    barrierFree: "verified",
    geometryConfidence: candidate.reconciliationStatus === "matched" ? "mapped" : "unknown",
    officialReconciliation: candidate.reconciliationStatus,
    evidence: {
      ...candidate.evidence,
      direction: factEvidence(
        candidate.evidence.existence.sourceIds,
        "unknown",
        "No reviewed official source establishes entry/exit direction restrictions for this entrance identity.",
      ),
    },
  }),
);

/** Canonical auditable union of geocoded routing points and official identity evidence. */
export const UTM_ENTRANCE_REGISTRY: readonly EntranceRegistryRecord[] = [
  ...geocoded,
  ...candidates,
];

export function entranceRegistryIssues(
  records: readonly EntranceRegistryRecord[] = UTM_ENTRANCE_REGISTRY,
): string[] {
  const buildingCodes = new Set(UTM_BUILDINGS.map((building) => building.code));
  const ids = new Set<string>();
  const issues: string[] = [];
  for (const record of records) {
    if (ids.has(record.id)) issues.push(`Duplicate entrance id: ${record.id}`);
    ids.add(record.id);
    if (!buildingCodes.has(record.buildingCode))
      issues.push(`Unknown building code: ${record.buildingCode}`);
    if (record.routability === "routable" && (!record.coordinates || !record.routingNodeId))
      issues.push(`Routable record lacks geometry or graph identity: ${record.id}`);
    if (record.kind === "pedestrian_approach" && record.geometryConfidence !== "inferred")
      issues.push(`Approach is not explicitly inferred: ${record.id}`);
    if (
      record.publicAccess === "restricted" &&
      record.evidence.publicAccess.confidence !== "verified"
    )
      issues.push(`Restricted endpoint lacks verified restriction evidence: ${record.id}`);
    if (record.direction !== "unknown" && record.evidence.direction.confidence !== "verified")
      issues.push(`Directional endpoint lacks verified direction evidence: ${record.id}`);
    if (
      record.barrierFree === "verified" &&
      record.routability === "routable" &&
      record.evidence.barrierFree.confidence !== "verified"
    )
      issues.push(`Step-free endpoint lacks verified evidence: ${record.id}`);
    for (const evidence of Object.values(record.evidence))
      if (evidence.sourceIds.length === 0) issues.push(`Fact lacks provenance: ${record.id}`);
  }
  return issues;
}
