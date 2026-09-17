import type {
  AccessibilityStatus,
  SourceMetadata,
  VerificationStatus,
} from "@/features/routing/types";
import { UTM_BUILDINGS } from "./building-registry";
import entranceDataRaw from "./entrances.geojson?raw";

export type EntranceKind = "entrance" | "approach";

export type BuildingEntrance = {
  id: string;
  label: string;
  kind: EntranceKind;
  coordinates: [number, number];
  /** Internal graph identity; verified doors do not have to originate in OpenStreetMap. */
  routingNodeId: string;
  /** Optional external OSM linkage retained for current data and interoperability. */
  osmNodeId?: number;
  externalIds?: {
    osmNodeId?: number;
  };
  accessibility: AccessibilityStatus;
  access: "public" | "restricted" | "emergency_only" | "unknown";
  direction: "entry" | "exit" | "both" | "unknown";
  /** Maintainer-reviewed default for ordinary building-level routing. */
  preferredForRouting: boolean;
  verificationMethod: string;
  sourceIdentifier: string;
  notes?: string;
  metadata: SourceMetadata;
};

export type CampusBuilding = {
  code: string;
  name: string;
  category: "academic" | "residence" | "facility";
  entrances: BuildingEntrance[];
  navigationPoint: [number, number];
  entranceNodeId: string;
  indoorMapped: boolean;
};

/**
 * Keep the building registry and assembled graph synchronized. This prevents a
 * future official/field-survey entrance from becoming a dangling route anchor.
 */
export function campusBuildingRoutingIssues(
  buildings: readonly CampusBuilding[],
  graphNodeIds: ReadonlySet<string>,
): string[] {
  const issues: string[] = [];

  for (const building of buildings) {
    const preferredEntrances = building.entrances.filter(\n      (entrance) => entrance.preferredForRouting,\n    );
    if (preferredEntrances.length > 1) {
      issues.push(`Building “${building.code}” has more than one preferred routing entrance.`);
    }
    const entranceNodeIds = new Set(building.entrances.map((entrance) => entrance.routingNodeId));
    if (!entranceNodeIds.has(building.entranceNodeId)) {
      issues.push(
        `Building “${building.code}” primary entrance node “${building.entranceNodeId}” is not one of its entrance routing nodes.`,
      );
    }

    for (const entrance of building.entrances) {
      if (!graphNodeIds.has(entrance.routingNodeId)) {
        issues.push(
          `Building “${building.code}” entrance “${entrance.id}” references missing routing node “${entrance.routingNodeId}”.`,
        );
      }
    }
  }

  return issues;
}

export function assertCampusBuildingRoutingIntegrity(
  buildings: readonly CampusBuilding[],
  graphNodeIds: ReadonlySet<string>,
): void {
  const issues = campusBuildingRoutingIssues(buildings, graphNodeIds);
  if (issues.length > 0) {
    throw new Error(`Campus building routing validation failed:\n- ${issues.join("\n- ")}`);
  }
}

type EntranceFeature = {
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    buildingCode: string;
    label: string;
    kind: EntranceKind;
    /** Existing OSM-backed records may omit routingNodeId and derive it from this ID. */
    osmNodeId?: number;
    /** Future official/field-survey doors may supply a non-OSM graph node directly. */
    routingNodeId?: string;
    accessibility: AccessibilityStatus;
    access?: BuildingEntrance["access"];
    direction?: BuildingEntrance["direction"];
    preferredForRouting?: boolean;
    verificationMethod?: string;
    sourceIdentifier?: string;
    notes?: string;
    source: string;
    sourceUrl: string;
    lastVerified: string;
    verificationStatus: VerificationStatus;
  };
};

const entranceFeatures = (JSON.parse(entranceDataRaw) as { features: EntranceFeature[] }).features;

function resolveRoutingNodeId(feature: EntranceFeature): string | null {
  if (feature.properties.routingNodeId?.trim()) return feature.properties.routingNodeId.trim();
  if (feature.properties.osmNodeId !== undefined) {
    return `osm-node-${feature.properties.osmNodeId}`;
  }
  return null;
}

function resolveVerificationMethod(feature: EntranceFeature): string | null {
  if (feature.properties.verificationMethod?.trim())
    return feature.properties.verificationMethod.trim();
  return feature.properties.osmNodeId !== undefined ? "published OSM entrance node" : null;
}

function resolveSourceIdentifier(feature: EntranceFeature): string | null {
  if (feature.properties.sourceIdentifier?.trim())
    return feature.properties.sourceIdentifier.trim();
  return feature.properties.osmNodeId !== undefined
    ? `osm:node/${feature.properties.osmNodeId}`
    : null;
}

function toEntrance(feature: EntranceFeature): BuildingEntrance | null {
  const routingNodeId = resolveRoutingNodeId(feature);
  const verificationMethod = resolveVerificationMethod(feature);
  const sourceIdentifier = resolveSourceIdentifier(feature);
  // Non-OSM entrances fail closed unless they provide explicit routing identity
  // and provenance semantics instead of inheriting an invented fallback.
  if (!routingNodeId || !verificationMethod || !sourceIdentifier) return null;

  const entrance: BuildingEntrance = {
    id: feature.id,
    label: feature.properties.label,
    kind: feature.properties.kind,
    coordinates: feature.geometry.coordinates,
    routingNodeId,
    accessibility: feature.properties.accessibility,
    access: feature.properties.access ?? "unknown",
    direction: feature.properties.direction ?? "unknown",
    preferredForRouting: feature.properties.preferredForRouting ?? false,
    verificationMethod,
    sourceIdentifier,
    metadata: {
      source: feature.properties.source,
      sourceUrl: feature.properties.sourceUrl,
      lastVerified: feature.properties.lastVerified,
      verificationStatus: feature.properties.verificationStatus,
    },
  };
  if (feature.properties.osmNodeId !== undefined) {
    entrance.osmNodeId = feature.properties.osmNodeId;
    entrance.externalIds = { osmNodeId: feature.properties.osmNodeId };
  }
  if (feature.properties.notes) entrance.notes = feature.properties.notes;
  return entrance;
}

/** One source of truth for every routable academic and residence building. */
export const CAMPUS_BUILDINGS: CampusBuilding[] = UTM_BUILDINGS.flatMap(
  (building): CampusBuilding[] => {
    const entrances = entranceFeatures
      .filter((feature) => feature.properties.buildingCode === building.code)
      .map(toEntrance)
      .filter((entrance): entrance is BuildingEntrance => entrance !== null)
      .sort((a, b) => Number(b.preferredForRouting) - Number(a.preferredForRouting));
    if (entrances.length === 0) return [];
    const primary = entrances.find((entrance) => entrance.preferredForRouting) ?? entrances[0]!;
    return [
      {
        code: building.code,
        name: building.name,
        category: building.category,
        entrances,
        navigationPoint: primary.coordinates,
        entranceNodeId: primary.routingNodeId,
        indoorMapped: false,
      } satisfies CampusBuilding,
    ];
  },
);

export const RESIDENCE_BUILDINGS = CAMPUS_BUILDINGS.filter(
  (building) => building.category === "residence",
);

export function getCampusBuilding(code: string | null): CampusBuilding | null {
  return CAMPUS_BUILDINGS.find((building) => building.code === code?.toUpperCase()) ?? null;
}

export function getResidenceBuilding(code: string | null): CampusBuilding | null {
  const building = getCampusBuilding(code);
  return building?.category === "residence" ? building : null;
}

export function hasVerifiedRoutingData(code: string): boolean {
  return (
    getCampusBuilding(code)?.entrances.some(
      (entrance) => entrance.metadata.verificationStatus === "verified",
    ) ?? false
  );
}

export function hasMappedRoutingData(code: string): boolean {
  return getCampusBuilding(code) !== null;
}
