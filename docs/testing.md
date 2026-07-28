# Testing

The MVP slices retain table-driven proof at each owning boundary and MUST pass
`corepack pnpm verify`.

## Slice matrix

| Slice | Required proof                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | accepted contracts, bootstrap root/package proof, full DAG positive graph, and exact negative probes                                                |
| 2     | every public spec/policy/error type, JSON guards/equality, every limit, stable fault ordering/truncation                                            |
| 3     | compiler normalization, graph/fork regions, canonical indexes, freeze/isolation, round-trip and tamper rejection                                    |
| 4     | entry/task/branch/terminal/noop, causal facts, faults-before-actions, actions-before-waits, terminal precedence                                     |
| 5a    | fork/join activation/readiness edges, regions, causal closure, and all/any/threshold partitions                                                     |
| 5b    | consensus/human-gate algorithms, verdict/resolution prerequisites, bounds, and faults                                                               |
| 6     | hostile unknown-JSON decoding, canonicality, faults, caps, deep ownership, and freezing                                                             |
| 7     | snapshot/command inspection, replay/conflict/lifecycle precedence, all commands, decision drain, and effect/snapshot consistency                    |
| 8     | exact five-value/86-type source/declaration/runtime surface, all-three documented scenarios, and strict exact-tarball consumers with denied imports |

## Semantic matrix

| Area          | Required partitions                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| node state    | every node kind × omitted/enabled/terminal cell                                                                                           |
| progression   | empty facts, initial activation, repeated intent, post-application continuation, defensive empty-activation and quiescence invariants     |
| terminal      | zero/one/two reached terminals and reached terminal before earlier residual parallel work                                                 |
| causality     | ordinary activation, fork activation/readiness, selector atomic targets, candidate/gate prerequisites                                     |
| branch        | fact missing, each case, default, typed equality, overlap/non-exhaustive/unreachable default                                              |
| join          | accepted/rejected/skipped/pending/impossible for all, any, and every threshold boundary                                                   |
| consensus     | unanimous/quorum/threshold approved/rejected/tied/insufficient/wait, abstain, irreversible result                                         |
| gate          | unresolved, every resolution, duplicate/foreign/premature/invalid resolution                                                              |
| compiled data | canonical sort/indexes, JSON round-trip, stale/tampered/noncanonical indexes                                                              |
| bounded input | over-limit array precheck, in-range key-count pruning, 33-key object pruning, every remaining bound                                       |
| reflection    | one array/object own-key reflection, documented O(K) caveats, numeric/canonical descriptor-first inspection                               |
| diagnostics   | insertion/overflow permutations, global truncation, definition lexical ties, decision code priority                                       |
| determinism   | input permutations, repeated evaluation, mutation isolation, recursive freeze                                                             |
| reduction     | uninitialized/active/terminal snapshots, command inspection, replay, conflicts, application, ordered atomic batches, waits, and terminals |

Architecture proof MUST cover the current graph, every allowed layer edge, and exact
representative failures for every structural rule. Package proof MUST use one tarball for
ATTW, contents, ESM, strict TypeScript, executable consumer examples, and runtime/type-level
deep-import denial. The same proof builds a symlink-free isolated tree from the exact
lockfile-resolved type closure and runs ordinary permission-denial probes for outside reads,
writes, child processes, and workers. The fixtures are trusted repository code; this is not
a sandbox or race-free containment claim. The finite package-flow validator is reused by
architecture tests and snapshots canonical imports, runner/access capabilities, the sole
child-process call, runtime launch options, direct verifier sequencing, unconditional
path-free cleanup, and retired-analyzer absence. Separate planner, artifact-tree, fixture,
and runner tests prove finite stable SemVer ranges, generic parent-local closure planning,
pack/access multiplicity, nominal identity, terminal completion, cleanup authorization,
fixed semantic operations, and prelaunch symlink rejection without invoking real package
commands.

Before merge, exact-head CI, a real Sonar quality gate with zero valid open issues, and
zero valid unresolved review threads are REQUIRED.

Vitest aggregate thresholds remain 90% statements, 90% lines, 90% functions, and 80%
branches. V8 coverage and its `lcov` report intentionally cover the production
`src/**/*.ts` surface only. `test` is registered as test code. Package and architecture
scripts are exercised by their separate mandatory harness and by
`corepack pnpm verify`; they are not Sonar production sources or V8 coverage inputs.
See [transition test traceability](./transition-test-traceability.md) for the named-test
and graph-invariant evidence behind every normative transition and testing matrix row.
