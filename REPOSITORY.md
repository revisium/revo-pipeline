# Repository Structure

`@revisium/revo-pipeline` is a strict ESM TypeScript library.

```text
src/spec/        readonly contracts
src/policy/      constants and bounded pure utilities
src/errors/      type-only faults and results
src/graph/       topology and graph algorithms
src/definition/  validation and deterministic compilation
src/transition/  decoding, decisions, and reduction
src/index.ts     curated public root
scripts/         architecture, coverage, and package verification
test/            behavior, structure, and package tests
docs/specs/      normative accepted contracts
docs/adr/        accepted architecture decisions
```

Dependency direction is `spec` → `errors` → `graph` → `definition`/`transition`, with
`policy` available to those layers. Cross-layer imports use curated layer barrels;
internal layers never import the package root.

The root exports only definition, transition, spec, and error contracts. Package
exports, not folders, define the public API. Tests consume the root or curated layer
barrels. Structural scripts enforce the exact rules.
