# Internal Module Structure

- Status: Accepted
- Version: 1.0.0
- Target package: `@revisium/revo-pipeline`

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

Directories MUST be created only with their first accepted behavior. This specification
does not authorize a bootstrap export.

## Dependency DAG

```text
spec
policy
spec + policy <- errors
spec + policy + errors <- graph
spec + policy + errors + graph <- definition
spec + policy + errors + graph <- transition
definition + transition + spec + errors <- root
```

| Layer        | Responsibility                                                   | Allowed layer imports               |
| ------------ | ---------------------------------------------------------------- | ----------------------------------- |
| `spec`       | portable readonly public contracts; type-only                    | none                                |
| `policy`     | immutable limits and pure package policy                         | none                                |
| `errors`     | portable fault contracts; type-only                              | `spec`, `policy`                    |
| `graph`      | bounded topology, reachability, sort, and fork-region algorithms | `spec`, `policy`, `errors`          |
| `definition` | validation, normalization, compilation                           | `spec`, `policy`, `errors`, `graph` |
| `transition` | pure facts-to-decision evaluation                                | `spec`, `policy`, `errors`, `graph` |

`graph` MUST NOT import `definition`. `transition` MUST NOT import `definition`; it
consumes compiled contracts and graph helpers. The root MUST be the only public barrel
after the later public implementation slice and MUST curate only `definition`,
`transition`, `spec`, and `errors`. It MUST NOT re-export internal `policy` or `graph`
helpers. During bootstrap it MUST remain exactly `export {};`.

## File and import rules

- Cross-layer imports MUST target `src/<layer>/index.ts`. Same-layer leaves MUST NOT
  import their own barrel. Relative specifiers MUST use `.js`.
- Layer barrels MUST use explicit named exports. `spec` and `errors` leaves and barrels
  MUST be type-only. Each production leaf MUST own exactly one exported entity.
- Tests MUST use only the root or a curated layer barrel. Production MUST NOT import
  tests, scripts, generated output, coverage, probes, or unknown `src/*` areas.
- Internal modules MUST NOT import the root. Consumers MUST use declared package exports;
  runtime and type-level private `dist` imports MUST fail.
- Runtime dependencies MUST remain zero. Production MUST NOT import
  `@revisium/revo-run`, agent/script packages, Prisma, DBOS, queues, NestJS, GraphQL,
  MCP, CLI, or another host framework.

## Required executable proof

The architecture harness MUST validate:

1. current source and test files;
2. a positive graph that exercises every allowed edge, including `errors -> policy`;
3. exact negative `layer-dependency` probes for both `graph -> definition` and
   `transition -> definition`;
4. missing `.js`, private cross-layer/test imports, own-barrel imports, value/type
   cycles, type-only layers/barrels, one-export leaves, broad barrels, root leakage,
   unknown areas, production escapes, and forbidden external packages;
5. removal of every temporary probe in `finally`, including after assertion failure.

A DAG rule change MUST update this specification, structural validator, unit partition,
and positive/negative executable harness in the same change.
