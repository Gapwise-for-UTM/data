# AGENTS.md

## Purpose

Gapwise Data is the canonical public campus-data repository for Gapwise. Preserve provenance, uncertainty, deterministic derivation, and reviewability.

## Entrance changes

For UTM entrance/access-point work, `data/utm/entrances.geojson` is the canonical entrance source of truth.

When adding, removing, moving, relabeling, or changing the semantics of an entrance:

1. Inspect the contribution/issue and the current building footprint, entrance records, and routing graph.
2. Change the canonical entrance record(s) in `data/utm/entrances.geojson`.
3. Every routable record must reference a real graph node using `osmNodeId` or `routingNodeId`.
4. Run:
   ```bash
   npm run entrances:derive
   ```
5. Run:
   ```bash
   npm run data:preflight
   ```
6. Open/review the PR visually at `https://data.gapwise.ca/review/map?pr=<PR_NUMBER>`.

Do **not** independently hand-edit routing nodes, edge lengths, generated entrance audits, campus-access counts, public entrance counts, or SHA256 checksums to make an entrance change appear consistent. The derive command owns those downstream updates.

If a proposed door has no trustworthy routing node or pedestrian-graph connection, stop and surface that unresolved requirement. Do not invent connectivity, accessibility, public-access status, direction, or provenance.

## Contribution issues

Issues produced by `data.gapwise.ca/contribute` contain a machine-readable JSON payload. Treat that payload as evidence/intake, not as already-canonical routing data. Confirm building association and duplicate proximity before promotion.

For multiple entrances, make one coherent canonical edit and derive once rather than repeating the pipeline entrance-by-entrance.

## Consumer boundary

Canonical campus facts live here. Gapwise core vendors a tested mirror under `src/data/utm` plus `public/data/utm-campus-v1.json`.

After a canonical data merge, the core consumer should be updated with its single sync command:

```bash
bun run campus-data:sync
```

Do not manually copy a subset of canonical files into the core repository.

## CI discipline

Remote pushes are not a debugging loop.

- Batch coherent edits before opening/updating a PR.
- Run the local preflight before pushing when possible.
- If CI exposes a problem, inspect all remaining jobs before pushing a correction so fixes can be batched.
- A visual-review comment is optional; the review URL in the Actions job summary is authoritative.
- Never weaken data-integrity checks merely to make a PR green.
