# Repository Structure

`@revisium/revo-pipeline` is a strict ESM TypeScript library.

## Current foundation

```text
src/index.ts                       intentionally empty shipped entrypoint
scripts/architecture/              structural source validation
scripts/verify-architecture.ts     positive graph and exact negative probes
scripts/verify-package.ts          one-tarball package/consumer proof
test/unit/scripts/                 validator behavior
test/package/                      bootstrap source/package assertions
docs/adr/                          decisions
docs/specs/                        Accepted contracts
.github/workflows/                 CI, validation, release train, npm publish
```

## Target source areas

Directories are created only with accepted behavior; this is a dependency map, not a
request for placeholders.

```text
src/
  spec/         portable readonly contracts; type-only
  policy/       immutable package constants and pure policy
  errors/       portable typed faults; type-only
  definition/   definition validation and compilation
  graph/        compiled graph inspection and structural algorithms
  transition/   pure PipelineFacts -> PipelineDecision evaluation
  index.ts      curated public package surface
```

Dependency direction:

```text
spec
policy
spec + policy <- errors
spec + policy + errors <- graph
spec + policy + errors + graph <- definition
spec + policy + errors + graph <- transition
```

Cross-layer imports go through the target layer's one curated
`src/<layer>/index.ts` barrel; a nested `index.ts` is a private leaf, not a barrel.
Same-layer leaves may import other leaves directly but must not import their layer
barrel. Relative imports use `.js`. Barrels use explicit named exports. Production leaves own one exported
entity; `spec` and `errors` leaves and barrels remain type-only. Unknown `src/*` areas and
production escapes into tests, scripts, build output, coverage, or probes fail closed.
Internal layers never import the package root. During bootstrap, `src/index.ts` is exactly
`export {};` and cannot import or re-export private layers.

Tests may use only the root or curated layer barrels. Public consumers use only declared
package exports. Package exports, not folders, define public API.
