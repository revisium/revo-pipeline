# Pipeline Transition v1

- Status: Accepted
- Version: 1.0.0
- Target package: `@revisium/revo-pipeline`

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

`decidePipeline(pipeline, facts)` MUST be synchronous, deterministic, side-effect-free,
and total for values in the portable input contract. It MUST NOT mutate its arguments,
observe time, generate an ID, perform I/O, persist, or retain state. Deeply equal inputs
MUST produce deeply equal decisions.

## Public facts and decisions

```ts
type JsonScalar = null | boolean | number | string;
type NodeKey = string;
type FactKey = string;
type CandidateKey = string;
type ResolutionName = string;

type NodeFact =
  | { readonly key: NodeKey; readonly state: 'enabled' }
  | { readonly key: NodeKey; readonly state: 'terminal'; readonly outcome: string };
type PipelineValueFact = { readonly key: FactKey; readonly value: JsonScalar };
type CandidateVerdict = {
  readonly nodeKey: NodeKey;
  readonly candidate: CandidateKey;
  readonly verdict: 'approve' | 'reject' | 'abstain';
};
type GateResolution = {
  readonly nodeKey: NodeKey;
  readonly resolution: ResolutionName;
};
type PipelineFacts = {
  readonly values: readonly PipelineValueFact[];
  readonly nodes: readonly NodeFact[];
  readonly candidateVerdicts: readonly CandidateVerdict[];
  readonly gateResolutions: readonly GateResolution[];
};

type ActivationCause =
  | { readonly kind: 'entry' }
  | { readonly kind: 'node'; readonly nodeKey: NodeKey; readonly outcome: string };
type WaitReason =
  | 'task-incomplete'
  | 'branch-fact-missing'
  | 'join-incomplete'
  | 'consensus-incomplete'
  | 'gate-unresolved';
type DecisionFaultCode =
  | 'FACT_TYPE'
  | 'FACT_LIMIT'
  | 'FACT_DUPLICATE'
  | 'FACT_FOREIGN'
  | 'FACT_OUTCOME'
  | 'FACT_CANDIDATE'
  | 'FACT_RESOLUTION'
  | 'FACT_PREMATURE'
  | 'FACT_CAUSAL'
  | 'PIPELINE_INVALID';
type DecisionFault = {
  readonly code: DecisionFaultCode;
  readonly path: string;
  readonly message: string;
};
type ActivateDecision = {
  readonly kind: 'activate';
  readonly cause: ActivationCause;
  readonly nodeKeys: readonly NodeKey[];
};
type SelectDecision = {
  readonly kind: 'select';
  readonly nodeKey: NodeKey;
  readonly outcome: string;
  readonly activate: readonly NodeKey[];
};
type WaitDecision = {
  readonly kind: 'wait';
  readonly nodeKey: NodeKey;
  readonly reason: WaitReason;
};
type TerminalDecision = {
  readonly kind: 'terminal';
  readonly nodeKey: NodeKey;
  readonly outcome: string;
};
type NoopDecision = { readonly kind: 'noop'; readonly reason: 'quiescent' };
type RejectDecision = {
  readonly kind: 'reject';
  readonly faults: readonly DecisionFault[];
};
type PipelineDecision =
  | ActivateDecision
  | SelectDecision
  | WaitDecision
  | TerminalDecision
  | NoopDecision
  | RejectDecision;
```

Omission from `nodes` MUST mean “not activated.” `active` and `waiting` MUST NOT be
accepted node states. An empty `PipelineFacts` snapshot MUST return entry activation:
`{kind:'activate', cause:{kind:'entry'}, nodeKeys:[pipeline.entry]}`.

## Total evaluation precedence

Evaluation MUST use this order:

1. Validate compiled integrity, input bounds, facts, duplicates, and causal closure.
2. Return `reject` if any fault exists.
3. Find definition terminals whose fact is enabled or terminal with the declared outcome.
4. If more than one terminal is reached, return stable `FACT_CAUSAL` at `/nodes`, even
   when their outcome strings are equal.
5. Return the sole reached terminal.
6. Otherwise return the first actionable `activate` or `select` in topological order.
7. Otherwise return the first blocked enabled node's deterministic `wait`.
8. Otherwise return `{kind:'noop', reason:'quiescent'}`.

A wait MUST NOT mask a later action. A reached terminal MUST globally outrank residual
losing-branch work after an `any` or threshold join. Activation arrays MUST use
topological order and MUST omit targets already present in `nodes`. If an activation
becomes empty defensively, evaluation MUST continue rather than return an empty activation.
For compiler-produced graphs and causally valid facts, however, an enabled selector with
every target already present is unreachable by the graph invariant below.
Unchanged pre-application facts MUST repeat the same intent; post-application facts
MUST NOT reactivate a target.

### Quiescence and empty-activation invariant

Compiler-produced graphs are finite DAGs in which every node is reachable from the entry and
leads to a terminal. Outside a fork, every decision advances one selected activation path. A fork
is the only fan-out: it atomically targets pairwise-disjoint branch entries and its join. Fork
region validation rejects cross-branch ingress, region escape, and barrier bypass; only declared
exit-task readiness edges reach the join. Therefore an enabled selector target cannot already
have an independently satisfied activation edge. Its own activation edge is not satisfied until
the selector is terminal.

For any causally valid snapshot, the following exhaustive frontier argument applies:

1. If the entry is omitted, entry activation is actionable.
2. If a definition terminal is enabled or terminal with its declared outcome, terminal
   precedence applies.
3. An enabled task deterministically waits. An enabled autonomous selector either selects when
   its prerequisites are present or deterministically waits.
4. A terminal task with an omitted selected successor activates that successor. A terminal
   selector already has every selected target by the atomic-target rule.
5. Following present terminal-selector targets through the finite DAG must reach an enabled
   node, a terminal task with an omitted successor, or a reached definition terminal.

Consequently `{kind:'noop', reason:'quiescent'}` and empty selector activation are unreachable for
compiler-produced graphs with valid facts. `NoopDecision` remains in the v1 public union to
preserve the Accepted API and exhaustive consumer code, and the evaluator retains the fallback
as a defensive totality guard. Implementations MUST NOT use noop to hide invalid compiled data,
invalid facts, or a reachable action, wait, or terminal.

## Node × state matrix

| Node kind  | Omitted                                           | Enabled                                              | Terminal                                                     |
| ---------- | ------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| task       | no action, except entry or predecessor activation | wait `task-incomplete`                               | activate mapped absent target; continue if target is present |
| branch     | no action                                         | wait for missing fact or select case/default         | selected target MUST be present                              |
| fork       | no action                                         | select `forked`, activating every entry and the join | every entry and the join MUST be present                     |
| join       | no action                                         | wait or select policy outcome                        | selected target MUST be present                              |
| consensus  | no action                                         | wait or select policy outcome                        | selected target MUST be present                              |
| human gate | no action                                         | wait or select declared resolution                   | selected target MUST be present                              |
| terminal   | no action                                         | return terminal                                      | re-emit the same declared terminal                           |

An autonomous selector is branch, fork, join, consensus, or human gate. Applying its
`select` MUST atomically record the selector terminal outcome and enable all listed
targets.

## Causal closure

The entry needs no predecessor. Every ordinary node fact MUST have a satisfied activation
edge. Fork-to-entry and fork-to-join edges with outcome `forked` are activation edges.
Exit-task-to-join edges are readiness edges and MUST NOT activate a join. Branch entries,
the join, and all fork-region members MUST have their owning fork terminal `forked`.

Task completion and successor activation are separate host operations. In contrast, an
autonomous selector terminal fact MUST include every selected target in the same fact
snapshot. A candidate verdict or gate resolution MUST reference its node while that node
is enabled or terminal. Verdict candidates and resolutions MUST belong to their compiled
closed sets. Duplicate, foreign, wrong-typed, impossible, contradictory, premature, and
causally orphaned facts MUST reject. No arrival state or `JoinArrival` exists.

## Branch and fork

A branch MUST wait when its declared value fact is absent. For a present value it MUST
select the one matching case, or its default only when no case matches. Equality MUST be
type-sensitive with NFC strings and normalized `-0`. Selection MUST NOT use first-match
behavior.

An enabled fork MUST select `forked` and activate every branch entry plus its join in one
decision. It MUST NOT schedule work or create runtime instances.

## Join algorithm

For each branch, the declared exit task outcome MUST map as follows:

| Exit fact                   | Derived branch status |
| --------------------------- | --------------------- |
| `completed`                 | accepted              |
| `failed` or `cancelled`     | rejected              |
| `skipped`                   | skipped               |
| exit absent or non-terminal | pending               |

Join readiness MUST be derived from those facts; no mutable counter is permitted.

- `all`: if any branch is rejected, select `rejected`. If a branch is pending and none is
  rejected, wait. Otherwise select `completed` when at least one branch is accepted and
  every other branch is accepted or skipped; select `insufficient` when all are skipped.
- `any`: if any branch is accepted, immediately select `completed`. Otherwise wait while
  any branch is pending. When none is pending, select `rejected` if any branch is
  rejected; otherwise select `insufficient` for the all-skipped case.
- `threshold(count)`: select `completed` as soon as accepted count reaches `count`.
  Otherwise let `possible = accepted + pending`. Wait while `possible >= count`. When
  `possible < count`, select `rejected` if any branch is rejected; otherwise select
  `insufficient`.

Early success for `any` and threshold MUST NOT command or cancel unfinished branches.
Their disposition is host-owned.

## Consensus algorithm

At most one verdict MAY exist per closed candidate. An absent verdict is pending;
`abstain` is a completed non-vote.

- `unanimous`: select `rejected` immediately on one reject. Select `approved` when every
  candidate approves. Wait while a missing verdict can still produce either result.
  Once complete, any abstention with no rejection selects `insufficient`.
- `quorum(q)`: wait for every candidate. If non-abstaining verdict count is below `q`,
  select `insufficient`. Otherwise compare approvals and rejections: greater approvals
  select `approved`, greater rejections select `rejected`, and equality selects `tied`.
- `threshold(approve, reject)`: select `approved` when approvals reach `approve`, or
  `rejected` when rejections reach `reject`. The definition bounds make simultaneous
  winners impossible. Otherwise, with `remaining` missing verdicts, select
  `insufficient` only when both `approvals + remaining < approve` and
  `rejections + remaining < reject`; wait in every other case.

## Human gate

An enabled gate with no resolution MUST wait with `gate-unresolved`. Exactly one declared
resolution MUST select its route. Authorization, durable answer storage, compare-and-set,
notification, timeout, and identity MUST remain host-owned.

## Compiled integrity and portable input

JSON-round-tripped compiled data MUST be supported. Before fact evaluation,
`decidePipeline` MUST boundedly validate compiled structure and canonical indexes.
Malformed, altered, stale, or noncanonical compiled data MUST return `PIPELINE_INVALID`.
All offsets MUST be zero-based safe integers and MUST agree with their canonical arrays,
keys, and endpoints. This is integrity validation, not cryptographic provenance.

Arrays MUST be prechecked by ordinary `length`. An oversized array MUST produce one
container limit fault without own-key reflection, descriptor or element inspection, or
descendant faults. An in-range array MUST perform exactly one `Reflect.ownKeys`, whose
`O(K)` time and memory cost for `K` own keys is unavoidable. Before sorting, descriptors,
or element reads, key count MUST equal `length + 1`; mismatch MUST produce one container
type fault and prune descendants. Matching keys MUST be exactly `length` plus canonical
decimal indices, and numeric descriptors MUST be inspected in index order without
invoking accessors. Sparse arrays and extra string, symbol, or noncanonical index
properties MUST reject. The reflection cost of adversarial in-range arrays with extra
keys is outside the bounded-work claim; all subsequent work remains bounded.

Plain objects MUST use one ECMAScript own-key reflection operation. Because ECMAScript
has no bounded own-key iterator, that operation necessarily costs `O(K)` time and memory
for `K` own keys. More than 32 reflected keys MUST produce one container limit fault with
no descriptor or descendant inspection. This initial reflection cost is outside the
bounded semantic-traversal claim.

Within the key limit, validators MUST inspect descriptors in canonical order before any
values. Ordinary JSON-compatible primitives, dense arrays, and plain objects are
supported. Sparse arrays, accessors, symbols, non-enumerable properties, custom
prototypes, functions, `undefined`, and fractional/unsafe/non-finite numbers MUST reject
without invoking getters or setters. Traversal MUST stop at the depth, visited-value,
and collection limits. Proxies are outside the portable contract; a throwing proxy trap
MAY propagate.

## Fact and diagnostic limits

| Input                                             |                 Maximum |
| ------------------------------------------------- | ----------------------: |
| value facts                                       |                     128 |
| node facts                                        |                     256 |
| candidate verdict facts                           |                   1,024 |
| gate resolution facts                             |                     256 |
| total facts across all four arrays                |                   1,664 |
| key or semantic name                              |  64 Unicode code points |
| fact string, outcome, or resolution display value | 512 Unicode code points |
| input depth / object own keys                     |                  8 / 32 |
| visited input values                              |                  16,384 |
| RFC 6901 path / message                           |  1,024 / 512 characters |
| canonical offending-value rendering               |          128 characters |
| returned faults                                   |                     100 |

For non-pruned input, validators MUST collect the complete fault set permitted by depth,
collection, and visit limits. Decision faults MUST globally sort by this explicit code
priority:

1. `PIPELINE_INVALID`
2. `FACT_TYPE`
3. `FACT_LIMIT`
4. `FACT_DUPLICATE`
5. `FACT_FOREIGN`
6. `FACT_OUTCOME`
7. `FACT_CANDIDATE`
8. `FACT_RESOLUTION`
9. `FACT_PREMATURE`
10. `FACT_CAUSAL`

After code priority they MUST sort by RFC 6901 path in Unicode code-point order, then
fault code lexically. Fixed messages and rendered offending values MUST NOT participate
in ordering. Up to 100 faults MUST be returned completely. More than 100 MUST return the
globally first 99 plus a fixed root `FACT_LIMIT` truncation fault as item 100.

## Required test matrix

Implementation MUST test:

- every row and cell of the node × state matrix;
- empty facts, initial activation, repeated intent, post-application continuation, empty
  activation defense, the quiescence invariant and retained public noop discriminator, one
  reached terminal, two reached terminals, and a reached terminal with earlier actionable
  losing-branch work;
- faults-before-actions, actions-before-waits, causal activation/readiness edges,
  autonomous atomic targets, candidate/gate prerequisites, foreign/duplicate/premature
  facts, and compiled round-trip/tamper;
- branch missing/present/default/type-sensitive equality and unreachable default;
- all join statuses and `all`, `any`, and threshold accepted/rejected/skipped/pending/
  impossible partitions;
- unanimous, quorum, and threshold consensus for every outcome, irreversible decisions,
  abstentions, ties, incomplete and impossible states;
- unresolved/resolved human gates and invalid resolutions;
- every definition/fact/traversal/diagnostic bound, limit-plus-sentinel behavior,
  descriptor rejection without accessor invocation, stable ordering and truncation;
- permutation determinism, repeated evaluation, mutation isolation, deep freeze, and
  zero runtime dependencies.

The package owns only this calculation. Durable runs, node instances, attempts, outputs,
events, CAS, leases, retries, resume, queues, authorization, and atomic decision
application MUST remain outside it.

## Shipped private shared decision seam

The public `decidePipeline` contract and its `noop` compatibility member remain
unchanged. PR7 extracted the private `decideValidated` operation that evaluates one
already inspected compiled context and validated projected facts. Both the public adapter
and reducer drain use that single semantic evaluator.

`decideValidated` MUST NOT inspect snapshots or commands, assemble effects, mutate
working state, perform persistence, or become a layer/root export. Public
`decidePipeline` continues to own hostile compiled and fact inspection and existing
fault mapping. Reducer settledness, fault mapping, and `noop` rejection remain reducer
responsibilities.
