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

The hostile compiled-integrity boundary MUST have exactly this private module map:

```text
transition/validate-compiled-pipeline.ts
transition/compiled/
  hostile-compiled-validation.ts
  validate-compiled-internally.ts
  precheck-compiled-bounds.ts
  snapshot-compiled-input.ts
  validate-compiled-members.ts
  validate-compiled-node.ts
  validate-compiled-branch.ts
  expected-compiled-semantics.ts
  derive-expected-compiled-semantics.ts
  compare-serialized-graph.ts
  verify-serialized-topology.ts
  verify-serialized-indexes.ts
```

The `compiled` directory MUST NOT contain a barrel. Every compiled leaf MUST own exactly
one export, remain absent from the transition and package-root barrels, and follow this
direct-import DAG:

```text
validate-compiled-pipeline / decide-pipeline
  -> compiled/validate-compiled-internally
validate-compiled-internally
  -> precheck-compiled-bounds
  -> snapshot-compiled-input
  -> validate-compiled-members -> validate-compiled-node -> validate-compiled-branch
  -> derive-expected-compiled-semantics -> expected-compiled-semantics
  -> compare-serialized-graph -> expected-compiled-semantics
  -> graph barrel
  -> verify-serialized-topology
  -> verify-serialized-indexes
  -> hostile-compiled-validation
```

No compiled leaf may import definition, the transition barrel, the public adapter,
decision facts/selectors, or decision evaluation.

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

The compiler proof resolves the direct-import chain and exported symbols across its
private definition leaves. Validation success MUST dominate normalization, projected
edges MUST be the input to preflight, preflight success MUST dominate the sole
`buildGraphKernel` call in `validateDefinitionGraph`, and the exact graph result MUST
flow unchanged through classification into assembly. A conditional, aliased, repeated,
unresolved, or out-of-order call fails closed.

The hostile-validation proof MUST resolve imported symbols across the compiled leaves and
construct a conservative inter-leaf control/data-flow proof. It MUST establish the exact
terminating guard order, a descriptor precheck before one snapshot, no caller reread,
independent expected derivation, exact comparison dominance, one exact builder input,
zero builds before equality, at most one afterward, and the same kernel in topology,
indexes, success, and decision evaluation. It MUST enumerate aliases, writes, escapes,
mutations, spread/computed/duplicate overrides, and fail closed when any provenance or
control-flow edge is unresolved. Dead or nested decoys MUST NOT satisfy the live proof.

Sonar issue exceptions MUST equal the reviewed criterion-name, rule-key, and exact
production-file allowlist in `sonar-project.properties`. Globs, directories, global or
rule-wide ignores, coverage exclusions, and duplication exclusions are forbidden.
The PR4b decomposition removes `boundedCompiledInspection`; it MUST NOT be replaced by a
leaf, directory, or wildcard suppression. The temporary expiry registry MUST be empty.
Additional criteria, globs, directory scopes, and owner records MUST fail verification.

Formatted physical source metrics are independently checked for explicitly enabled
production leaves. A leaf spans its first line through its final non-terminal-newline line;
blank and comment lines count. 250 lines pass and 251 fail `production-leaf-span`.
Runtime callable spans are measured recursively from the first declaration or expression
token through the closing body or expression token. Function declarations, function
expressions, arrows, methods, constructors, getters, setters, object methods, and nested
callables are included; type-only and body-less signatures are excluded. 60 lines is an
advisory review target; 80 pass and 81 fail `production-callable-span`.

Metric scopes MUST reject duplicate entries and paths absent from the collected production
modules before selecting files. PR4a MUST activate its scope through complete derivation
from every `src/definition/**` TypeScript production leaf, excluding only the layer barrel;
it MUST NOT use a manually enumerated subset or grandfather list. Adding a definition leaf
therefore adds it to the derived PR4a scope without a registry update.

PR4b MUST additionally derive its integrity scope from every TypeScript leaf under
`src/transition/compiled/**` plus `src/transition/validate-compiled-pipeline.ts`. It MUST
exclude `decide-pipeline.ts`, use no grandfather list, and retain the PR4a scope. Adding a
compiled leaf therefore adds it to the enforced 250/80 limits without a registry update.

Compiler and hostile graph-flow both use symbol-resolved structural and dataflow proof.
Digest pinning, weaker scanning, path-only allowlists, or temporary analyzer disablement is
forbidden.

A DAG rule change MUST update this specification, structural validator, unit partition,
and positive/negative executable harness in the same change.
