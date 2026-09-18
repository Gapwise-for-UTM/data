# Entrance contribution workflow

Gapwise Data provides a visual entrance contribution tool at `https://data.gapwise.ca/contribute` and a maintainer-oriented view at `https://data.gapwise.ca/studio/entrances`.

The contribution UI is deliberately an **evidence intake layer**, not a direct editor for canonical routing data. A browser submission becomes a reviewable GitHub issue containing a machine-readable payload conforming to [`schemas/entrance-contribution.schema.json`](../../schemas/entrance-contribution.schema.json). Canonical `entrances.geojson`, registry records, routing graph inputs, and provenance are changed only after maintainer review.

## Contributor flow

1. Choose a canonical UTM building.
2. Click the exterior doorway location on the canonical building-footprint map, or select an existing mapped entrance to contribute additional facts.
3. State how the entrance was observed and the observation date.
4. Record public access, direction, and barrier-free status separately. `unknown` is always valid and should be preferred over guessing.
5. Review the generated contribution and submit it for review on GitHub.

The map warns when a new point is within five metres of an existing mapped entrance so contributors can explicitly identify duplicate geometry rather than silently creating another door.

## Evidence boundaries

A field observation that a physical door exists does **not** by itself establish unrestricted public access, entrance direction, or barrier-free suitability. Each of those is a separate claim.

Do not submit:

- faces or identifying student information;
- access-control details, credentials, keys, or restricted-area information;
- private floor plans or material the contributor is not allowed to publish;
- inferred accessibility claims based only on how a doorway looks;
- copied proprietary map coordinates.

For source-backed contributions, include the public source URL. For field observations, notes should describe only publishable physical context needed to distinguish the doorway.

## Maintainer review

Before promotion into canonical data:

- confirm the building association;
- inspect duplicate-distance warnings and existing entrance identity;
- verify that every non-unknown access/direction/accessibility claim has evidence appropriate to that fact;
- keep source provenance fact-specific;
- reject coordinates derived from proprietary map transposition;
- update canonical entrance geometry or evidence records only after review;
- run `npm run data:validate` and the downstream core routing contract before merge.

The maintainer Studio exposes the same canonical footprints and mapped entrances as the public tool, plus the exact machine-readable contribution payload for use in follow-up data work.

## Deep links

Product surfaces may link directly to a building with:

```text
https://data.gapwise.ca/contribute?building=MN
```

This is the intended integration for Gapwise map coverage notices such as “Partial coverage” or “Know an entrance we're missing?”.


## Maintainer fast path: one canonical edit, one derive command

For routable UTM entrance changes, **`data/utm/entrances.geojson` is the source of truth for entrance identity, building association, display/routing coordinates, labels, access semantics, and provenance**.

Do not hand-edit the same entrance across routing nodes, audit files, public snapshot counts, and checksums. After reviewing or adding the canonical entrance records, run:

```bash
npm run entrances:derive
```

That command refreshes the matching routing-node metadata and coordinates, incident edge distances when coordinates moved, the routable entrance audit, campus access counts, public snapshot counts, and checksums. Then run:

```bash
npm run data:preflight
```

CI runs the same coherence rules. It rejects an entrance with a missing graph node, a wrong building association, graph/canonical coordinate drift, stale audit records, or stale public counts.

The derive command intentionally does **not** invent a new pedestrian-graph connection. A genuinely new door must reference a real routing node through `osmNodeId` or `routingNodeId`; if none exists, stop and verify the graph connection instead of guessing.

For human review, use:

```text
https://data.gapwise.ca/review/map?pr=<PR_NUMBER>
```

The workflow always places this URL in the Actions job summary. Posting the same URL as a PR comment is best-effort, so comment-permission problems no longer make an otherwise-valid data PR fail.
