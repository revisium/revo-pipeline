# Testing

The MVP slices retain table-driven proof at each owning boundary and MUST pass
`corepack pnpm verify`.

## Slice matrix

| Slice | Required proof                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------- |
| 1     | accepted contracts, bootstrap root/package proof, full DAG positive graph, and exact negative probes             |
| 2     | every public spec/policy/error type, JSON guards/equality, every limit, stable fault ordering/truncation         |
| 3     | compiler normalization, graph/fork regions, canonical indexes, freeze/isolation, round-trip and tamper rejection |
| 4     | entry/task/branch/terminal/noop, causal facts, faults-before-actions, actions-before-waits, terminal precedence  |
| 5a    | fork/join activation/readiness edges, regions, causal closure, and all/any/threshold partitions                  |
| 5b    | consensus/human-gate algorithms, verdict/resolution prerequisites, bounds, and faults                            |
| 6     | exact root manifest, docs/examples, permutation/repeat properties, packed public consumer proof                  |

## Semantic matrix

| Area          | Required partitions                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| node state    | every node kind × omitted/enabled/terminal cell                                                                      |
| progression   | empty facts, initial activation, repeated intent, post-application continuation, empty activation continuation, noop |
| terminal      | zero/one/two reached terminals and reached terminal before earlier residual parallel work                            |
| causality     | ordinary activation, fork activation/readiness, selector atomic targets, candidate/gate prerequisites                |
| branch        | fact missing, each case, default, typed equality, overlap/non-exhaustive/unreachable default                         |
| join          | accepted/rejected/skipped/pending/impossible for all, any, and every threshold boundary                              |
| consensus     | unanimous/quorum/threshold approved/rejected/tied/insufficient/wait, abstain, irreversible result                    |
| gate          | unresolved, every resolution, duplicate/foreign/premature/invalid resolution                                         |
| compiled data | canonical sort/indexes, JSON round-trip, stale/tampered/noncanonical indexes                                         |
| bounded input | over-limit array precheck, in-range key-count pruning, 33-key object pruning, every remaining bound                  |
| reflection    | one array/object own-key reflection, documented O(K) caveats, numeric/canonical descriptor-first inspection          |
| diagnostics   | insertion/overflow permutations, global truncation, definition lexical ties, decision code priority                  |
| determinism   | input permutations, repeated evaluation, mutation isolation, recursive freeze                                        |

Architecture proof MUST cover the current graph, every allowed layer edge, and exact
representative failures for every structural rule. Package proof MUST use one tarball for
ATTW, contents, ESM, strict TypeScript, and runtime/type-level deep-import denial.

Before merge, exact-head CI, a real Sonar quality gate with zero valid open issues, and
zero valid unresolved review threads are REQUIRED.
