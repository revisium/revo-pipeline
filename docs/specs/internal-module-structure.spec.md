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

The architecture harness MUST also run the fail-closed TypeScript AST graph-kernel-flow
proof. That proof MUST establish exactly one compiler and one hostile-validator
`buildGraphKernel` call site, required trust-gate dominance and independent inputs, the
stripping adapter's non-exposure, same-binding flow into evaluation, and the absence of
rebuild, cache, retained-state, dynamic lookup, or ambiguous-alias paths. Its tooling
leaf MUST export only `validateGraphKernelFlow`; it MUST NOT add a runtime or package
export.

The proof is intentionally syntax-constraining and fail-closed. Required compiler
prerequisites and the kernel builder MUST remain direct top-level operations; placing
them behind a conditional, switch, loop, `try`, callback, retry, or recursive function
MUST fail. Hostile validation MUST pass the direct independently-derived
`expectedEdges` binding and the direct `pipeline.nodes -> key` projection; serialized
edges, indexes, aliases, factories, and unproven expressions MUST fail. The
`canonicalCoreGraph` promotion helper MUST have exactly one unconditional call site.
Any source parse, binding, module-resolution, or semantic diagnostic MUST make the
proof fail rather than weaken it.

Compiler proof MUST distinguish diagnostic derivation from hostile promotion. It MUST
accept the sole kernel only from canonical copied and sorted nodes plus a fresh,
known-endpoint, immutable `inducedEdges` projection carrying exact
`(from, outcome, to)` values, after one unconditional structural fork-region preflight.
Existing definition faults MUST NOT suppress that safe induced diagnostic path. Generic
region ownership MUST run once after the kernel. A successful compiler result MUST prove
equal edge counts and exact semantic-offset, `from`, `outcome`, and `to` identity before
serialization; removing or inverting any conjunct MUST fail. Legacy private adjacency,
per-branch traversal, endpoint mutation, induced-input mutation, builder-input
substitution, and final semantic-offset mismatch MUST fail.

Region shared rows MUST be selected only after the supplied topology is proven to contain
every safe integer node offset exactly once and every kernel edge is proven to point from
an earlier to a later topology position. Topology validation node and edge reads MUST be
operation-counted. Any malformed claimed order MUST use the bounded fallback and preserve
the counts already spent rejecting the shared-row path.

Hostile validation MUST prove exact failure polarity and unconditional termination for
region and edge equality before its builder. `expectedEdges` MUST start as one fresh
array, receive only independently projected node edges, undergo only the approved
readiness-field normalization and one canonical sort, and have no direct or transitive
hostile alias, unknown-helper escape, endpoint write, or post-equality mutation.
Tracked calls embedded in `&&`, `||`, `??`, a ternary, assignment, argument, callback,
loop, `switch`, `try`, or nested function MUST fail closed.

The complete transitive proof is bound to reviewed AST-body digests for
`compilePipeline`, `preflightForkRegions`, `classifyForkRegions`,
`validateCompiledInternally`, `canonicalCoreGraph`, `canonicalRegions`, and
`independentlyDerivedRegionMembers`. These owners collectively contain every A4 tracked
compiler and hostile collection, writer, traversal, alias, helper boundary, equality
gate, and builder input. A body change not recognized by the narrower semantic checks
MUST still fail its owner digest. Updating a digest without reviewing the full owner
body, its transitive collection table, fixtures, and this specification is forbidden.

The transitive boundary additionally pins the complete source text of
`src/definition/compile-pipeline.ts` and
`src/transition/validate-compiled-internally.ts`. This full-file digest includes every
outer precheck, node/edge projection, branch policy, readiness normalization,
collection writer, and helper reachable from the seven primary owners. Any change
anywhere in either file MUST fail architecture verification until the complete file
boundary is reviewed and the file digest, owner digests, specification, and adversarial
fixtures are reconciled together. Updating only a digest is not an accepted fix.

A DAG rule change MUST update this specification, structural validator, unit partition,
and positive/negative executable harness in the same change.
