# Internal Module Structure

- Status: Accepted
- Version: 2.0.0
- Target package: `@revisium/revo-pipeline`

## Stable boundaries

The package remains pure, portable, ESM-only, and free of runtime dependencies.
Dependency direction is:

```text
spec
policy
spec + policy <- errors
spec + policy + errors <- graph
spec + policy + errors + graph <- definition
spec + policy + errors + graph <- transition
definition + transition + spec + errors <- root
```

Cross-layer production and test imports use curated layer barrels. Internal layers do not
import the package root, private modules do not cross layer boundaries, production does
not escape `src`, and value or type cycles are forbidden. Production imports neither
Node built-ins nor bare runtime packages; all relative imports resolve.

The package root exposes only the accepted definition/transition values and public
spec/error types. Package exports define the public API; private deep imports remain
denied to packed consumers. `spec` and `errors` remain type-only layers.

## Verification ownership

- Pinned Oxlint owns supported forbidden-package rules, explicit `.js` extensions for
  static imports and export-from declarations, and the production 80-line callable
  limit. It runs once in `verify`. Dynamic and type-only extension forms remain covered
  by the project TypeScript/package compilation configuration because the pinned Oxlint
  rule does not reject extensionless literal dynamic imports or import-type expressions.
- Pinned dependency-cruiser owns layer direction, cross-layer private imports,
  root re-entry, production escapes, Node/bare runtime imports, resolution, and all
  transitive value/type cycles. It runs once through `verify:architecture`.
- Vitest and packed-consumer verification own the exact normalized root declaration,
  type-only emitted `spec`/`errors` modules, public API, zero runtime dependencies,
  deep-import denial, bounds, purity, graph behavior, decoding, decisions, reduction,
  package lifecycle, and permissions.
- Sonar contract tests own the reviewed allowlist and temporary-expiry policy.

Local call spelling, statement order, aliases, dominance, same-binding identity,
one-export-per-leaf, exact incidental private inventories, and exact internal barrel
syntax/source/phase are not architecture contracts. No custom AST or source parser may
reintroduce those constraints.
