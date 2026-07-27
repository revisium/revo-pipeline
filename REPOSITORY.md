# Repository Structure

`@revisium/revo-pipeline` is a strict ESM TypeScript library.

## Current implementation

```text
src/index.ts                       exact curated MVP public root
src/spec/                          type-only accepted contract foundation
src/policy/                        immutable limits and pure bounded utilities
src/errors/                        type-only fault and result contracts
src/graph/                         bounded topology, reachability and region algorithms
src/definition/                    identity helper, validation and deterministic compilation
src/transition/                    decoding inspector and pure seven-node transition evaluation
scripts/architecture/              structural source validation
scripts/verify-architecture.ts     positive graph and exact negative probes
scripts/verify-package.ts          one-tarball package/consumer proof
test/unit/policy/                  portable policy and bound behavior
test/unit/spec/                    type contract assertions
test/unit/graph/                   graph algorithm behavior
test/unit/definition/              compiler validation, canonicalization and isolation
test/unit/transition/              core/coordination policy, integrity, precedence and replay
test/unit/scripts/                 validator behavior
test/package/                      exact source/package manifest assertions
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
Internal layers never import the package root. The public root has a fail-closed exact
manifest and curates only definition, transition, spec, and errors layer barrels.

Tests may use only the root or curated layer barrels. Public consumers use only declared
package exports. Package exports, not folders, define public API.
