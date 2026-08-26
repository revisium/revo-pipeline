# Host-runtime intent ownership for the greenfield cutover

- Status: Draft
- Baseline date: 2026-08-09
- Baseline set: `rr-001` through `rr-103`

This matrix preserves the semantic intent of the current host-runtime acceptance registry;
it does not preserve its recursive node shapes, compiler template, or prior bridge
schema. “Compiler” includes source, materialization, linker, IR, and static validation.
“Core” stores and version-selects raw source, profiles, and agent definitions, then starts
a run. “Run” includes exact binding resolution, the DBOS host, action attempts,
durability, projections, and API transport.

The acceptance suite MUST mechanically import the upstream intent registry and prove
that this table contains the same IDs with no gaps or extras. A row marked “host-only”
requires no new pipeline behavior, but still requires a consumer boundary fixture when
it depends on a program requirement, structural reference, or kernel event/command.

The 103 unique rows have primary-owner counts compiler 22, kernel 32, core 0, and run 49. The evidence counts are pipeline evidence 54 and host evidence 49; host evidence
includes core/run cross-package fixtures. This matrix is ownership traceability, not a
request for 103 separate pipeline implementations.

| ID     | Preserved semantic intent                                              | Primary owner | Required pipeline evidence                                                                        |
| ------ | ---------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| rr-001 | Execute an agent and pass its output to a script                       | run           | Compiler activity/dataflow trace; kernel output-to-input routing                                  |
| rr-002 | Route permanent agent failure explicitly                               | kernel        | Activity-failed event selects declared route                                                      |
| rr-003 | Bound agent execution by timeout and route it                          | run           | Final failed event crosses kernel boundary; timer is host-only                                    |
| rr-004 | Execute an immutable versioned script binding                          | run           | Versioned script requirement survives compile and run-composition resolution                      |
| rr-005 | Route permanent script failure without retry                           | kernel        | Activity-failed event selects declared route; retry is host-only                                  |
| rr-006 | Bound script execution by timeout                                      | run           | Host-only timer/attempt policy plus final semantic event                                          |
| rr-007 | Retry transient agent failure with durable backoff                     | run           | Host-only; kernel sees one logical activity completion                                            |
| rr-008 | Stop script retry at the configured attempt limit                      | run           | Host-only attempt policy plus final failed event                                                  |
| rr-009 | Retry only allowlisted error codes                                     | run           | Host-only error classification                                                                    |
| rr-010 | Resume durable retry backoff after restart                             | run           | Host-only DBOS timer recovery                                                                     |
| rr-011 | Reconcile an external action after pre-checkpoint crash                | run           | Script requirement/structural ref fixture; reconciliation is host-only                            |
| rr-012 | Require attributed human resolution for unknown action outcome         | run           | Host-only reconciliation command/audit                                                            |
| rr-013 | Deterministically fail an action configured to fail on unknown outcome | run           | Host-only reconciliation policy plus final failed event                                           |
| rr-014 | Execute an action once after restart before action start               | run           | Host-only durable dispatch/deduplication                                                          |
| rr-015 | Bound reconciliation attempts                                          | run           | Host-only attempt policy                                                                          |
| rr-016 | Retry safely only after reconciliation proves action absence           | run           | Host-only action reconciliation                                                                   |
| rr-017 | Cooperatively cancel an active agent execution                         | run           | Kernel emits `cancelPending`; host performs cooperative cancellation                              |
| rr-018 | Cancel while waiting for retry backoff                                 | run           | Host-only timer cancellation; kernel terminal cancellation is idempotent                          |
| rr-019 | Treat repeated run cancellation as idempotent                          | kernel        | Repeated `cancelRequested` leaves terminal state unchanged                                        |
| rr-020 | Preserve completed terminal state after cancellation request           | kernel        | Terminal immutability test                                                                        |
| rr-021 | Fail an unhandled custom activity outcome                              | kernel        | Undeclared outcome produces deterministic machine failure                                         |
| rr-022 | Ignore inherited outcome-route properties                              | compiler      | TypeBox closed object and own-property validation fixture                                         |
| rr-023 | Select a choice from completed node output                             | kernel        | Dominating output reference plus choice routing                                                   |
| rr-024 | Use an explicit default for uncovered choice value                     | compiler      | Default exhaustiveness and kernel selection fixture                                               |
| rr-025 | Wait for every qualifying branch at an all join                        | kernel        | Generic parallel `all` truth table                                                                |
| rr-026 | Run a multi-step region as one parallel branch                         | compiler      | Structured branch lowering and scoped dataflow fixture                                            |
| rr-027 | Fail all-policy parallel and drain remaining branches                  | kernel        | Early decision plus `remaining: drain` fixture                                                    |
| rr-028 | Drain remaining branches after any-policy success                      | kernel        | `any` early success plus drain fixture                                                            |
| rr-029 | Fail any-policy parallel when no branch can qualify                    | kernel        | `any` impossibility truth table                                                                   |
| rr-030 | Drain branches before threshold completion                             | kernel        | Threshold decision plus drain fixture                                                             |
| rr-031 | Publish branch input failure through the run event stream              | run           | Compiler input fault attribution; event publication is host-only                                  |
| rr-032 | Expose parallel branch outputs after the region                        | compiler      | Region merge/dataflow schema fixture                                                              |
| rr-033 | Apply run parallelism limit across nested branches                     | run           | Structural refs expose pending frontier; scheduling limit is host-only                            |
| rr-034 | Cancel remaining branches after threshold success                      | kernel        | Threshold early success emits `cancelPending`                                                     |
| rr-035 | Fail threshold when it becomes unreachable                             | kernel        | Threshold early-impossibility truth table                                                         |
| rr-036 | Approve unanimous consensus after every approval                       | kernel        | Lowered vote-parallel unanimous fixture                                                           |
| rr-037 | Reject unanimous consensus on first rejection                          | kernel        | Early unanimous rejection fixture                                                                 |
| rr-038 | Report inconclusive consensus for insufficient quorum                  | kernel        | Quorum participation excludes abstentions                                                         |
| rr-039 | Apply independent approve and reject thresholds                        | compiler      | Exact-count mutual-exclusion validation plus kernel thresholds                                    |
| rr-040 | Reject duplicate and unknown participant votes                         | kernel        | Vote output/reference validation fixture                                                          |
| rr-041 | Route participant execution failure without inventing a vote           | kernel        | `participantFailed` route; failure is not reject/abstain                                          |
| rr-042 | Route consensus timeout without waiting forever                        | run           | Host timer yields explicit failure/cancellation event; kernel route fixture                       |
| rr-043 | Continue a human gate after manager restart                            | run           | Serialized kernel state plus durable host gate fixture                                            |
| rr-044 | Accept idempotent gate command and reject conflicts                    | run           | Host-only command ID and durable conflict policy                                                  |
| rr-045 | Require distinct authorized approvers                                  | run           | Host-only identity, authorization, and separation-of-duties policy                                |
| rr-046 | Reject an ineligible gate actor                                        | run           | Host-only authorization                                                                           |
| rr-047 | Arbitrate conflicting multi-approver answers                           | run           | Arbitration is host-owned; the kernel accepts one declared terminal gate resolution               |
| rr-048 | Reject answer outside gate vocabulary                                  | kernel        | Closed answer validation fixture                                                                  |
| rr-049 | Route an unanswered gate after deadline                                | run           | Host-owned timer delivers declared deadline resolution                                            |
| rr-050 | Cancel while waiting at a human gate                                   | run           | Kernel `cancelPending`/`cancel`; host closes gate                                                 |
| rr-051 | Pass immutable input into a subpipeline and return output              | compiler      | Linked `call` input/output mapping fixture                                                        |
| rr-052 | Route a failed called-module outcome in its caller                     | kernel        | Call-frame outcome routing fixture                                                                |
| rr-053 | Reject a missing called module                                         | compiler      | Linker missing-target diagnostic                                                                  |
| rr-054 | Pass previous repeat output into next iteration                        | kernel        | Repeat next-input and iteration-scope fixture                                                     |
| rr-055 | Support bounded repeat nested in repeat                                | compiler      | Composed bound plus nested frame fixture                                                          |
| rr-056 | Route repeat exhaustion at iteration limit                             | kernel        | Exact-bound exhaustion fixture                                                                    |
| rr-057 | Reject unbounded repeat                                                | compiler      | Required positive `maximumIterations` validation                                                  |
| rr-058 | Pass a pinned entity reference without embedding entity data           | run           | Portable opaque reference schema; resolution through a run-composition port                       |
| rr-059 | Pass a durable artifact reference between activities                   | run           | Opaque output/input mapping; artifact store is host-only                                          |
| rr-060 | Resolve a secret only at executor boundary and never persist it        | run           | Requirement contains no secret value; resolution is host-only                                     |
| rr-061 | Keep reference-shaped executor JSON inert                              | compiler      | Data mappings interpret only schema-declared references                                           |
| rr-062 | Fail safely when a secret cannot be resolved                           | run           | Host-only resolution plus final failed event                                                      |
| rr-063 | Fail deterministically when a pinned entity version is unavailable     | run           | Run-composition resolution fails before executor dispatch                                         |
| rr-064 | Store a large result as artifact reference                             | run           | Host-only output externalization                                                                  |
| rr-065 | Use an explicitly pinned artifact as input                             | run           | Opaque input fixture; retrieval is host-only                                                      |
| rr-066 | Fail when a referenced output key is missing                           | kernel        | Runtime own-property read emits `DATA_POINTER_MISSING`; static absence is a compiler error        |
| rr-067 | Fail when a referenced JSON Pointer is missing                         | kernel        | Runtime RFC 6901 traversal emits `DATA_POINTER_MISSING`; invalid static projection never compiles |
| rr-068 | Map a bounded activity over dynamic entities                           | kernel        | Map item expansion and maximum-items fixture                                                      |
| rr-069 | Complete an empty map without dispatch                                 | kernel        | Empty-map behavior fixture                                                                        |
| rr-070 | Encode data-controlled map keys in runtime paths safely                | kernel        | Canonical structural item-reference fixture                                                       |
| rr-071 | Reject map input above declared item bound                             | kernel        | Runtime item-count bound fixture                                                                  |
| rr-072 | Cancel remaining map items after fail-fast failure                     | kernel        | Fail-fast `cancelPending` fixture                                                                 |
| rr-073 | Enforce map-local concurrency independently of item count              | kernel        | Kernel emits at most map `maximumConcurrency`; run separately owns global capacity                |
| rr-074 | Collect failed map items in deterministic aggregate output             | kernel        | Aggregate sorted by canonical item key                                                            |
| rr-075 | Survive restart during durable delay                                   | run           | Serialized wait state; DBOS timer is host-only                                                    |
| rr-076 | Cancel durable delay without waiting for deadline                      | run           | Kernel cancellation plus host timer cancellation                                                  |
| rr-077 | Cancel active parallel children without detached work                  | run           | Kernel emits complete `cancelPending` reference set; host joins cancellation                      |
| rr-078 | Recover parallel execution without duplicate actions                   | run           | Stable structural refs; DBOS deduplication is host-only                                           |
| rr-079 | Enforce run-wide active execution limit                                | run           | Host-only scheduler over kernel command frontier                                                  |
| rr-080 | Resume run subscription from durable cursor                            | run           | Host-only event log and cursor                                                                    |
| rr-081 | Publish durable terminal failure event                                 | run           | Kernel `fail` causation; durable publication is host-only                                         |
| rr-082 | Reject a cursor belonging to another run                               | run           | Host-only subscription validation                                                                 |
| rr-083 | Expose every nested execution through run details                      | run           | Structural refs map to run projections                                                            |
| rr-084 | Resume subscription cursor after manager restart                       | run           | Host-only durable event log                                                                       |
| rr-085 | Reject unsupported persisted-run schema version                        | run           | Run-owned admitted-record schema gate; no pipeline API obligation                                 |
| rr-086 | Reject an admitted run missing its compiler program                    | run           | Run-owned compiler-bundle admission plus `programDigest` fixture                                  |
| rr-087 | Require exactly one executor binding per activity requirement          | run           | Run-composition requirement-to-binding totality fixture                                           |
| rr-088 | Reject duplicate executor bindings                                     | run           | Run-composition binding-key uniqueness fixture                                                    |
| rr-089 | Reject repeat bound above total execution bound                        | compiler      | Overflow-safe composed activity-bound proof                                                       |
| rr-090 | Reject a choice needing but missing a default route                    | compiler      | Choice exhaustiveness fixture                                                                     |
| rr-091 | Reject binding targeting a missing activity requirement                | run           | Run-composition requirement-key referential-integrity fixture                                     |
| rr-092 | Reject binding targeting a control node                                | run           | Run admits bindings only for `ProgramRequirements`                                                |
| rr-093 | Reject duplicate sibling node IDs                                      | compiler      | Canonical ID uniqueness fixture                                                                   |
| rr-094 | Reject duplicate addressable keys across parallel branches             | compiler      | Structural-reference uniqueness fixture                                                           |
| rr-095 | Reject reserved characters in node ID                                  | compiler      | Identifier schema fixture                                                                         |
| rr-096 | Reject reserved characters in root pipeline/module ID                  | compiler      | Package/module identifier schema fixture                                                          |
| rr-097 | Reject duplicate runtime map item keys                                 | kernel        | Canonical item-key uniqueness fixture                                                             |
| rr-098 | Reject unreachable consensus threshold                                 | compiler      | Exact participant-count threshold validation                                                      |
| rr-099 | Reject composed map/repeat bound above total limit                     | compiler      | Overflow-safe nested bound proof                                                                  |
| rr-100 | Reject structure beyond nesting bound                                  | compiler      | Nesting-depth fixture                                                                             |
| rr-101 | Reject call composition beyond depth bound                             | compiler      | Linked call-depth fixture                                                                         |
| rr-102 | Reject direct call recursion                                           | compiler      | Linker cycle diagnostic                                                                           |
| rr-103 | Reject indirect call recursion                                         | compiler      | Multi-module linker cycle diagnostic                                                              |

## Machine-readable acceptance rule

Before acceptance, tooling MUST generate or validate a canonical record with fields
`intentId`, `category`, `name`, `primaryOwner`, and `pipelineEvidence`. The upstream
`intentId`, `category`, and `name` values MUST be imported rather than copied by hand.
This Markdown table remains the review surface; the generated/validated record is the
drift gate.
