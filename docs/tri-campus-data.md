# Tri-campus canonical data

Gapwise treats UTM, UTSG, and UTSC as separate campus namespaces. UTM keeps its existing hand-reviewed canonical entrance/routing pipeline. St. George and Scarborough begin from source-backed identity inventories, live timetable evidence cached at refresh time, and open-licensed map geometry.

## Sources

- **UTSG identities:** University of Toronto Facilities & Services 2025 Building Automation Systems Design Standard, Appendix C, plus current timetable building evidence from U of T Timetable Builder.
- **UTSC identities/codes:** current official UTSC campus map and Registrar timetable location-code page, plus current timetable evidence from U of T Timetable Builder.
- **Geometry:** exact identity matches against OpenStreetMap. A City of Toronto Building Outline is used only when one unambiguous City polygon contains the centre of an exact OpenStreetMap identity match.
- **Pedestrian graph:** OpenStreetMap outdoor pedestrian ways inside campus bounds.

The live Timetable Builder endpoint is institution-operated but not a published developer contract. It is therefore used only by the refresh workflow to cache evidence; Gapwise does not depend on it at runtime.

## Verification semantics

An imported building footprint or pedestrian edge is **inferred** until independently reviewed. A `derived-routing-approach` is only the nearest pedestrian-network vertex to a mapped footprint. It is never a claim that the coordinate is a physical entrance.

The refresh workflow fails closed for ambiguous identity/geometry reconciliation and emits explicit unresolved coverage. Never choose a polygon merely because it is the nearest building.

## Refresh

The branch-scoped GitHub workflow `.github/workflows/tri-campus-refresh.yml` runs the source refresh, validation, and generated-data commit. The generated report is `data/tri-campus-coverage.json`.

Before production merge, all generated outputs must be reviewed visually and the existing UTM data/entrance pipeline must remain byte-compatible unless a deliberate UTM change is part of the PR.
