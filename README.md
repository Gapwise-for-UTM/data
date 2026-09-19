<div align="center">

<img src="public/logo-mark.svg" width="116" alt="Gapwise Data deer logo" />

# Gapwise Data

### The canonical open-data and provenance layer behind Gapwise.

**A transparent, developer-friendly home for the University of Toronto campus data that powers Gapwise: buildings, geometry, routing evidence, provenance, validation, attribution, and reuse.**

[![Data](https://img.shields.io/badge/Data-data.gapwise.ca-B42335?style=for-the-badge&logo=databricks&logoColor=white)](https://data.gapwise.ca)
[![Docs](https://img.shields.io/badge/Docs-data_guides-111111?style=for-the-badge)](https://docs.gapwise.ca/data/)

<sub>React · Vite · GeoJSON · JSON Schema · SHA-256 · Vercel</sub>

<br />

**[Gapwise](https://gapwise.ca)** · **[Android](https://github.com/Gapwise-for-UofT/android)** · **[iOS](https://github.com/Gapwise-for-UofT/ios)** · **[API](https://api.gapwise.ca/v1)** · **[AI](https://ai.gapwise.ca)** · **[Data](https://data.gapwise.ca)** · **[Docs](https://docs.gapwise.ca)** · **[Status](https://status.gapwise.ca)**

</div>

---

## What Gapwise Data is

`data` is the **canonical repository for public UTM campus facts and geometry used by Gapwise**. The checked-in dataset under [`data/utm`](data/utm) contains building identity, map geometry, entrances, routing graph inputs, indoor/outdoor graph artifacts, provenance, confidence metadata, and generated audit data.

Gapwise as a product supports timetable identity across **UTM, UTSG, UTSC, and mixed-campus schedules**. This repository is intentionally narrower: the current first-party campus map, route graph, place data, and open-data distribution are **UTM-focused**. That scope boundary is part of the data contract, not a limitation to hide.

The main [`gapwise`](https://github.com/Gapwise-for-UofT/gapwise) repository remains authoritative for deterministic product behavior: timetable semantics, route calculation, gap planning, public API orchestration, SDK contracts, and map/product presentation. It vendors a checked-in snapshot of this repository's campus data so production routing never depends on `data.gapwise.ca` or GitHub being reachable at request time.

> **`data` knows what UTM is. `gapwise` knows what to do with that knowledge.**

---

## What the data layer covers

- canonical UTM building and facility identities;
- campus geometry and building footprints;
- mapped, inferred, and evidence-only entrances;
- outdoor routing nodes and edges;
- available indoor graph data;
- routing coverage and route-evidence states;
- accessibility evidence and explicit uncertainty;
- provenance and source identifiers;
- generated routing/access audits;
- validation and dataset-integrity checks;
- attribution and reuse requirements;
- versioned privacy-safe public data.

The current public Gapwise campus snapshot contains **30 canonical UTM buildings/facilities** and is consumed through the same deterministic platform semantics used by Gapwise web, Android, iOS, API, SDK, and AI-facing surfaces.

---

## Data principles

1. **One canonical source.** Public UTM campus facts and geometry are changed here first; downstream repositories consume snapshots or contracts.
2. **Explain transformations.** Published data should make clear where it came from and how it changed.
3. **Separate fact from inference.** Derived navigation data must not masquerade as direct observation.
4. **Prefer stable identifiers.** Codes and source IDs make downstream integrations more durable.
5. **Preserve uncertainty.** Unknown or unverified facts stay visible as unknown or unverified.
6. **Preserve provenance.** Source information belongs with the dataset, not in somebody's memory.
7. **No runtime coupling.** Consumer applications vendor or build against a pinned snapshot; a data-site or GitHub outage must not break campus routing.

---

## First-party distribution

Production builds publish the complete validated `data/utm` tree from a first-party Gapwise domain:

```text
https://data.gapwise.ca/datasets/utm/latest/
```

Machine-readable integrity manifest:

```text
https://data.gapwise.ca/datasets/utm/latest/manifest.json
```

Each manifest entry records the artifact path, byte size, SHA-256 digest, canonical first-party URL, and canonical organization-owned repository. The manifest schema is published at:

```text
https://data.gapwise.ca/schemas/dataset-manifest.schema.json
```

`latest` is a current channel. Reproducibility-sensitive consumers should pin checksums or an immutable versioned release when one is available.

Applications that want stable Gapwise semantics should normally prefer the API/SDK. Raw distribution is appropriate for provenance inspection, research, visualization, validation, or custom derivation pipelines.

---

## Consumer model

The core application intentionally keeps a compatibility mirror at `gapwise/src/data/utm` because the web app, public API, routing engine, tests, and build tooling already import those paths. That mirror is **not an independent source of truth**.

The core repository provides synchronization commands:

```bash
bun run campus-data:check
bun run campus-data:sync
bun run campus-data:publish
```

Data-writing routing/survey maintenance commands still synchronize from this repository before running and publish resulting canonical artifacts back afterward. That generator layer remains a transitional dependency while validation/routing types are decoupled from core.

Normal production requests do not perform cross-repository or `data.gapwise.ca` fetches.

---

## Maintenance documentation

Source-adjacent maintenance notes live under [`docs/maintenance`](docs/maintenance), including source/provider boundaries, geometry and identity rules, field-survey rules, and access-audit ownership.

Public developer-facing explanations belong at **https://docs.gapwise.ca/data/**. The Data repository intentionally does not become a second developer-documentation site.

---

## Validation

Run the integrity validator with:

```bash
npm run data:validate
```

It verifies, among other things:

- canonical ownership metadata;
- required building/entrance/routing graph files;
- JSON and GeoJSON parseability;
- the 30-building public snapshot and unique building codes;
- SHA-256 integrity for every checked-in canonical campus file.

`npm run build` validates the dataset, verifies the public distribution contract, builds the portal, and publishes the raw distribution tree into the deployment output.

---

## Gapwise ecosystem

| Repository | Role | Primary surface |
| --- | --- | --- |
| **[`gapwise`](https://github.com/Gapwise-for-UofT/gapwise)** | Core web/PWA, canonical timetable/gap/routing semantics, public API, OpenAPI, and SDK source | [gapwise.ca](https://gapwise.ca) / [api.gapwise.ca](https://api.gapwise.ca/v1) |
| **[`android`](https://github.com/Gapwise-for-UofT/android)** | Native Kotlin + Jetpack Compose Android client | Android app |
| **[`ios`](https://github.com/Gapwise-for-UofT/ios)** | Native Swift + SwiftUI iOS client | iOS app |
| **[`ai`](https://github.com/Gapwise-for-UofT/ai)** | OAuth/MCP layer for explicitly delegated student context and bounded actions | [ai.gapwise.ca](https://ai.gapwise.ca) |
| **[`data`](https://github.com/Gapwise-for-UofT/data)** | **Canonical public University of Toronto campus data, provenance, schemas, validation, and distribution** | [data.gapwise.ca](https://data.gapwise.ca) |
| **[`docs`](https://github.com/Gapwise-for-UofT/docs)** | Canonical public developer documentation | [docs.gapwise.ca](https://docs.gapwise.ca) |
| **[`status`](https://github.com/Gapwise-for-UofT/status)** | Independent service-health monitoring and incident communication | [status.gapwise.ca](https://status.gapwise.ca) |

No consumer repository should recreate or silently fork UTM campus facts. Native clients and product surfaces may adapt presentation and platform integration, but source campus facts belong here and deterministic product calculations belong to `gapwise`.

---

## For developers

- **GitHub organization:** https://github.com/Gapwise-for-UofT
- **Developer hub:** https://gapwise.ca/developers
- **Developer docs:** https://docs.gapwise.ca
- **Data docs:** https://docs.gapwise.ca/data/
- **Data portal:** https://data.gapwise.ca
- **Dataset manifest:** https://data.gapwise.ca/datasets/utm/latest/manifest.json
- **API:** https://api.gapwise.ca/v1
- **OpenAPI 3.1:** https://api.gapwise.ca/openapi.json
- **JavaScript / TypeScript SDK:** `@gapwise/sdk@0.1.1` on npm and JSR
- **Python SDK:** `gapwise==0.1.0` on PyPI

```bash
npm install @gapwise/sdk@0.1.1
python -m pip install gapwise==0.1.0
```

Gapwise source code is MIT licensed, but upstream datasets retain their own terms. OpenStreetMap-derived records require appropriate OpenStreetMap attribution and ODbL compliance; the MIT license does not override upstream data obligations.

---

## Local development

```bash
git clone https://github.com/Gapwise-for-UofT/data.git
cd data
npm ci
npm run data:preflight
npm run dev
```

For a production build:

```bash
npm run build
npm run preview
```

Use Node.js 24, matching CI. The committed lockfile pins the complete build dependency graph.
`data:preflight` checks canonical data, entrance coherence, public distribution, and isolated
pipeline regression tests. Tests never rewrite the working dataset.

For an entrance edit, change `data/utm/entrances.geojson`, run `npm run entrances:derive`,
then `npm run data:preflight`. Derivation rejects ambiguous identities, missing graph
connections, or incomplete non-OSM provenance before writing generated files. Removing
an entrance that is still a graph entrance requires an explicit topology review; the tool
does not invent a replacement node role or connection. Keep the visual review at
`https://data.gapwise.ca/review/map?pr=<PR_NUMBER>` in the review workflow.

After Data merges, run `bun run campus-data:sync` and `bun run campus-data:check` in the
sibling core checkout. The Data compatibility job exercises this same complete sync,
including the public snapshot, before running core's campus contract tests.

---

## Independent project

> **Gapwise is an independent student software project created by Andrew Muratov. It is not affiliated with, endorsed by, or an official service of the University of Toronto.**

<div align="center">

**Open campus data is more useful when its uncertainty is visible.**

[Explore Gapwise Data →](https://data.gapwise.ca)

</div>
