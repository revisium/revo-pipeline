# Testing

## Principles

- Behavior follows red -> green -> refactor.
- Test pure semantic partitions with table-driven unit tests.
- Expected decisions are written independently from actual results.
- Fixtures contain every fact read by the decision engine.
- Tests use public or curated layer entrypoints rather than private cross-layer files.
- Skips and quality exclusions require an owner, reason, and removal condition.

## Proof layers

| Layer        | Owns                                                              |
| ------------ | ----------------------------------------------------------------- |
| Unit         | Validation, compilation, graph algorithms, transition partitions  |
| Contract     | Stable public definition/decision input and output compatibility  |
| Architecture | Layer DAG, type cycles, forbidden imports, structural conventions |
| Package      | ESM exports, declarations, packed contents, consumer resolution   |

Only unit tests for repository tooling and package tests exist in the foundation.
Behavior lanes are added with their first accepted behavior; no empty lane is retained.

Architecture proof must include the current graph, a representative synthetic positive
graph, and exact negative probes for cycles, missing `.js`, private imports, forbidden
external packages, unknown production areas, production escapes, root leakage, reverse
dependencies, type-only barrels, and cleanup. Tests may consume a curated layer
`index.js`, but not a private layer leaf.

The package proof creates one tarball with an isolated npm cache. ATTW, content checks,
isolated ESM execution, strict TypeScript resolution, and deep-import denial all consume
that exact artifact. Runtime and type-level private deep imports must both fail.

During package foundation, v8 coverage includes `scripts/architecture/**/*.ts` in
addition to `src/**/*.ts`; architecture tooling is owned executable behavior rather than
an unmeasured repository helper.
