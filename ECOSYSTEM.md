# Gapwise ecosystem integration

`data` is the **canonical public UTM campus-data, provenance, and reuse surface** of the seven-repository Gapwise product ecosystem. It owns public UTM campus facts and geometry; it does not redefine deterministic product calculations or public API behavior.

Gapwise timetable identity supports UTM, UTSG, UTSC, and mixed-campus schedules. This repository remains UTM-focused until equivalent first-party campus evidence is deliberately added. Timetable coverage and campus-data coverage are separate claims.

## Connected surfaces

| Surface | Canonical location | Relationship to Gapwise Data |
| --- | --- | --- |
| Student web/PWA + public API + SDK source | `Gapwise-for-UofT/gapwise` | vendors a validated campus-data snapshot and owns deterministic routing/gap-planning behavior plus public API/SDK contracts |
| Native Android | `Gapwise-for-UofT/android` | consumes Gapwise product/API contracts; it must not maintain a parallel UTM dataset |
| Native iOS | `Gapwise-for-UofT/ios` | consumes Gapwise product/API contracts; it must not maintain a parallel UTM dataset |
| AI/MCP | `Gapwise-for-UofT/ai` | exposes deterministic Gapwise campus semantics through MCP and delegated context; it is not a data-authority replacement |
| Developer docs | `Gapwise-for-UofT/docs` | documents released API/SDK contracts and links raw data/provenance back here |
| Status | `Gapwise-for-UofT/status` | monitors public service health independently and does not depend on raw campus data for routing semantics |

## Developer-platform state

- API: `https://api.gapwise.ca/v1`
- OpenAPI: `https://api.gapwise.ca/openapi.json`
- TypeScript SDK: `@gapwise/sdk`
  - npm `0.1.1` is published with provenance
  - JSR `0.1.1` is published with provenance through GitHub Actions OIDC
  - one portable TypeScript implementation targets Node, Bun, Deno, and browser consumers rather than separate runtime SDKs
- Python SDK: `gapwise==0.1.0` is published on PyPI through Trusted Publishing
- Android source: `https://github.com/Gapwise-for-UofT/android`
- iOS source: `https://github.com/Gapwise-for-UofT/ios`
- Docs: `https://docs.gapwise.ca`
- Data: `https://data.gapwise.ca`
- AI/MCP: `https://ai.gapwise.ca/api/mcp`
- Status: `https://status.gapwise.ca`

TypeScript and Python are equal first-party SDK implementations. Applications should normally consume the stable API/SDK contract rather than importing raw repository data unless they specifically need source-level provenance or geometry.

## Data-specific source-of-truth rules

1. Canonical public UTM campus records originate in `data/utm` in this repository.
2. `gapwise/src/data/utm` is a checked-in compatibility mirror, validated byte-for-byte in CI; it is not a second authority.
3. Public API and SDK behavior follows OpenAPI and the core implementation; this repository owns facts/evidence, not API semantics.
4. Unknown/inferred/approximate/unverified states remain explicit in data and downstream representations.
5. Upstream attribution and ODbL obligations remain attached to data even when consuming Gapwise code is MIT licensed.
6. Production routing must not depend on `data.gapwise.ca` or GitHub being reachable at request time.
7. Android and iOS must consume canonical campus/product contracts rather than silently growing independent UTM datasets.
8. A schema/data-version change should trigger review of core API/SDK output, developer docs, native consumers, AI grounding, and relevant status probes.

## Change impact

When canonical campus data changes, check whether the change affects:

- the `gapwise` vendored mirror and deterministic route/gap outputs;
- TypeScript and Python public models/examples;
- `docs` data/provenance/API pages;
- `android` behavior exposed through stable contracts;
- `ios` behavior exposed through stable contracts;
- `ai` grounded public campus tools;
- `status` monitored data/API endpoints.

The ecosystem is intentionally interconnected, but ownership stays explicit: **Data owns public UTM facts; Core owns deterministic calculations/contracts; Docs explains releases; Android and iOS consume; AI exposes bounded context; Status communicates health.**
