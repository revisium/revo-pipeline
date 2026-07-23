# Internal Module Structure

- Status: Draft
- Target package: `@revisium/revo-pipeline`

The foundation already enforces this proposed structure against a synthetic positive
graph and exact negative probes. Production areas are created only with accepted
behavior.

## Layers

| Layer        | Responsibility                                    | Allowed dependencies                  |
| ------------ | ------------------------------------------------- | ------------------------------------- |
| `spec`       | Portable readonly contracts; type-only            | none                                  |
| `policy`     | Immutable constants and pure package policy       | none                                  |
| `errors`     | Portable typed faults; type-only                  | `spec`                                |
| `definition` | Validation, normalization, compilation            | `spec`, `policy`, `errors`            |
| `graph`      | Compiled topology inspection and graph algorithms | previous layers through their barrels |
| `transition` | Pure facts-to-decision evaluation                 | all previous layers through barrels   |
| root         | Curated public API after contract acceptance      | curated exports only                  |

The order is strict; a lower layer never imports a higher layer. `spec` and `policy` are
independent leaves. `errors` remains type-only so diagnostics contracts cannot pull
behavior back into specification.

## File rules

- Relative imports and exports use `.js` specifiers.
- Cross-layer imports target exactly the destination `src/<layer>/index.ts`.
- Nested `index.ts` files are private leaves, not curated barrels.
- Same-layer leaves do not import their `src/<layer>/index.ts` barrel.
- Barrels use explicit named exports; wildcard and namespace barrels are forbidden.
- `spec` and `errors` barrels use explicit `export type` syntax; value exports fail.
- Each production leaf owns one exported entity.
- `spec` and `errors` leaves contain only interfaces, type aliases, type-only imports,
  and type-only exports.
- Tests consume the source root or a curated layer barrel, not private cross-layer files.
- Production never imports tests, fixtures, build output, repository scripts, or
  generated verification probes.
- Unknown `src/*` ownership areas fail closed, internal layers cannot import the package
  root, and the bootstrap root remains exactly empty.
- Public consumers use package exports and cannot deep-import `dist`.

## Forbidden dependencies

Production has no runtime dependency in the foundation. In particular it never imports:

- `@revisium/revo-run`;
- Prisma or another persistence implementation;
- DBOS, pg-boss, Graphile Worker, or another durable queue/runtime;
- NestJS, GraphQL, MCP, or CLI frameworks;
- agent or script implementations.

A future external pure utility dependency requires an accepted boundary decision and an
explicit allowlist change; architecture validation remains fail-closed.

## Required proof

Architecture verification must:

1. validate the current source/test graph;
2. validate a representative synthetic positive graph spanning every layer;
3. prove type/value cycle detection with type cycles included;
4. prove forbidden external imports fail;
5. prove test/private and cross-layer private imports fail;
6. prove missing `.js`, own-barrel, reverse-layer, type-only, one-export, and explicit
   barrel rules fail with exact rule identities;
7. remove every temporary probe in `finally`, including after a failed assertion.

Changing a rule requires updating its structural unit partition and the executable
positive/negative architecture harness in the same change.
