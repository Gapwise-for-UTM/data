export type CampusSourceId =
  | "openstreetmap"
  | "utm-facilities-buildings"
  | "utm-facilities-snow-ice"
  | "utoronto-interactive-map"
  | "utoronto-robotics-2025-conference";

export type CampusSourceRecord = {
  id: CampusSourceId;
  organization: string;
  title: string;
  url: string;
  sourceType: "official_web" | "official_interactive_map" | "community_map";
  retrievedAt: string;
  notes?: string;
};

export type EvidenceConfidence = "verified" | "corroborated" | "approximate" | "unknown";

export type FactEvidence = {
  sourceIds: readonly CampusSourceId[];
  confidence: EvidenceConfidence;
  lastVerified: string;
  notes?: string;
};

export const CAMPUS_SOURCE_RECORDS = {
  openstreetmap: {
    id: "openstreetmap",
    organization: "OpenStreetMap contributors",
    title: "OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
    sourceType: "community_map",
    retrievedAt: "2026-08-10",
    notes:
      "Reviewed entrance-tagged nodes and pedestrian topology under ODbL. An entrance tag establishes mapped door geometry, not public access or barrier-free suitability unless separately tagged.",
  },
  "utm-facilities-buildings": {
    id: "utm-facilities-buildings",
    organization: "University of Toronto Mississauga Facilities Management & Planning",
    title: "Buildings",
    url: "https://www.utm.utoronto.ca/facilities/buildings",
    sourceType: "official_web",
    retrievedAt: "2026-08-21",
  },
  "utm-facilities-snow-ice": {
    id: "utm-facilities-snow-ice",
    organization: "University of Toronto Mississauga Facilities Management & Planning",
    title: "UTM Strategy for Snow and Ice Removal",
    url: "https://www.utm.utoronto.ca/facilities/utm-strategy-snow-and-ice-removal",
    sourceType: "official_web",
    retrievedAt: "2026-08-21",
    notes:
      "Priority 1 explicitly names barrier-free building entrance identities. It does not publish exact door coordinates or establish the accessibility of every connecting route edge.",
  },
  "utoronto-interactive-map": {
    id: "utoronto-interactive-map",
    organization: "University of Toronto",
    title: "University of Toronto Interactive Map",
    url: "https://map.utoronto.ca/?id=1809",
    sourceType: "official_interactive_map",
    retrievedAt: "2026-08-21",
    notes:
      "Used only for visual QA and corroboration. Gapwise does not scrape, copy, or reverse-engineer proprietary map assets or transpose marker positions into routing coordinates.",
  },
  "utoronto-robotics-2025-conference": {
    id: "utoronto-robotics-2025-conference",
    organization: "University of Toronto Robotics Institute",
    title: "2025 Toronto Robotics Conference",
    url: "https://robotics.utoronto.ca/2025-toronto-robotics-conference/",
    sourceType: "official_web",
    retrievedAt: "2026-09-13",
    notes:
      "Official U of T conference logistics repeatedly name the 'MN north entrance (2nd floor)' as a coach-bus departure point. This verifies a north exterior entrance identity and level context, but publishes no exact door coordinate and does not establish that it is synonymous with Facilities' Main, Field side, or Lot #1 barrier-free identities, nor does it establish unrestricted public access or barrier-free status.",
  },
} as const satisfies Record<CampusSourceId, CampusSourceRecord>;

export function factEvidence(
  sourceIds: readonly CampusSourceId[],
  confidence: EvidenceConfidence,
  notes?: string,
): FactEvidence {
  const evidence: FactEvidence = {
    sourceIds,
    confidence,
    lastVerified: "2026-08-21",
  };
  if (notes) evidence.notes = notes;
  return evidence;
}
