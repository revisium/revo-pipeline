# Pipeline Definition v1

- Status: Accepted
- Version: 1.0.0
- Target package: `@revisium/revo-pipeline`

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

This specification fixes the contract for later implementation. It does not ship an API:
`src/index.ts` MUST remain exactly `export {};` until the public implementation slice.

## Public contract

```ts
declare function definePipeline<const T extends PipelineDefinition>(definition: T): T;
declare function compilePipeline(definition: PipelineDefinition): PipelineCompilation;
declare function decidePipeline(pipeline: CompiledPipeline, facts: PipelineFacts): PipelineDecision;

type JsonScalar = null | boolean | number | string;
type NodeKey = string;
type FactKey = string;
type CandidateKey = string;
type BranchName = string;
type ResolutionName = string;
type TaskOutcome = 'completed' | 'failed' | 'cancelled' | 'skipped';
type FactType = 'null' | 'boolean' | 'number' | 'string';

type FactDefinition = {
  readonly key: FactKey;
  readonly type: FactType;
};

type TaskRoutes = Readonly<Record<TaskOutcome, NodeKey>>;
type BranchPredicate =
  | { readonly op: 'equals'; readonly value: JsonScalar }
  | { readonly op: 'oneOf'; readonly values: readonly JsonScalar[] };
type BranchCase = {
  readonly name: BranchName;
  readonly when: BranchPredicate;
  readonly to: NodeKey;
};
type BranchDefault = { readonly name: BranchName; readonly to: NodeKey };
type ForkBranch = {
  readonly name: BranchName;
  readonly entry: NodeKey;
  readonly exit: NodeKey;
};

type AllJoinPolicy = { readonly kind: 'all' };
type AnyJoinPolicy = { readonly kind: 'any'; readonly remaining: 'unconstrained' };
type ThresholdJoinPolicy = { readonly kind: 'threshold'; readonly count: number };
type JoinPolicy = AllJoinPolicy | AnyJoinPolicy | ThresholdJoinPolicy;
type JoinOutcome = 'completed' | 'rejected' | 'insufficient';
type JoinRoutes = Readonly<Record<JoinOutcome, NodeKey>>;

type UnanimousConsensusPolicy = { readonly kind: 'unanimous' };
type QuorumConsensusPolicy = { readonly kind: 'quorum'; readonly quorum: number };
type ThresholdConsensusPolicy = {
  readonly kind: 'threshold';
  readonly approve: number;
  readonly reject: number;
};
type ConsensusPolicy = UnanimousConsensusPolicy | QuorumConsensusPolicy | ThresholdConsensusPolicy;
type ConsensusOutcome = 'approved' | 'rejected' | 'insufficient' | 'tied';
type ConsensusRoutes = Readonly<Record<ConsensusOutcome, NodeKey>>;
type HumanGateRoute = { readonly resolution: ResolutionName; readonly to: NodeKey };

type TaskNode = {
  readonly kind: 'task';
  readonly key: NodeKey;
  readonly outcomes: TaskRoutes;
};
type BranchNode = {
  readonly kind: 'branch';
  readonly key: NodeKey;
  readonly fact: FactKey;
  readonly cases: readonly BranchCase[];
  readonly default: BranchDefault | null;
};
type ForkNode = {
  readonly kind: 'fork';
  readonly key: NodeKey;
  readonly join: NodeKey;
  readonly branches: readonly ForkBranch[];
};
type JoinNode = {
  readonly kind: 'join';
  readonly key: NodeKey;
  readonly fork: NodeKey;
  readonly policy: JoinPolicy;
  readonly outcomes: JoinRoutes;
};
type ConsensusNode = {
  readonly kind: 'consensus';
  readonly key: NodeKey;
  readonly candidates: readonly CandidateKey[];
  readonly policy: ConsensusPolicy;
  readonly outcomes: ConsensusRoutes;
};
type HumanGateNode = {
  readonly kind: 'humanGate';
  readonly key: NodeKey;
  readonly subject: string;
  readonly resolutions: readonly HumanGateRoute[];
};
type TerminalNode = {
  readonly kind: 'terminal';
  readonly key: NodeKey;
  readonly outcome: string;
};
type PipelineNode =
  TaskNode | BranchNode | ForkNode | JoinNode | ConsensusNode | HumanGateNode | TerminalNode;

type PipelineDefinition = {
  readonly schemaVersion: 1;
  readonly entry: NodeKey;
  readonly facts: readonly FactDefinition[];
  readonly nodes: readonly PipelineNode[];
};
```

`definePipeline<const T extends PipelineDefinition>(definition: T): T` MUST be an
identity/type-inference helper. It MUST NOT validate, clone, freeze, perform I/O, or
register the definition.

## Compiled contract

```ts
type CompiledNode = PipelineNode;
type CompiledEdgeRole = 'activation' | 'readiness';
type CompiledEdge = {
  readonly from: NodeKey;
  readonly outcome: string;
  readonly to: NodeKey;
  readonly role: CompiledEdgeRole;
  readonly fork: NodeKey | null;
  readonly branch: BranchName | null;
};
type CompiledForkBranch = ForkBranch & { readonly members: readonly NodeKey[] };
type CompiledForkRegion = {
  readonly fork: NodeKey;
  readonly join: NodeKey;
  readonly branches: readonly CompiledForkBranch[];
};
type CompiledNodeIndexEntry = { readonly key: NodeKey; readonly node: number };
type CompiledEdgeIndexEntry = { readonly key: NodeKey; readonly edges: readonly number[] };
type CompiledPipeline = {
  readonly schemaVersion: 1;
  readonly entry: NodeKey;
  readonly facts: readonly FactDefinition[];
  readonly nodes: readonly CompiledNode[];
  readonly edges: readonly CompiledEdge[];
  readonly topologicalOrder: readonly NodeKey[];
  readonly forkRegions: readonly CompiledForkRegion[];
  readonly nodeIndex: readonly CompiledNodeIndexEntry[];
  readonly outgoingIndex: readonly CompiledEdgeIndexEntry[];
  readonly incomingIndex: readonly CompiledEdgeIndexEntry[];
};

type DefinitionFaultCode =
  | 'DEF_TYPE'
  | 'DEF_UNKNOWN_FIELD'
  | 'DEF_LIMIT'
  | 'DEF_SCHEMA'
  | 'DEF_KEY'
  | 'DEF_DUPLICATE'
  | 'DEF_ENTRY'
  | 'DEF_TARGET'
  | 'DEF_UNREACHABLE'
  | 'DEF_DEAD_END'
  | 'DEF_EDGE'
  | 'DEF_CYCLE'
  | 'DEF_BRANCH_AMBIGUOUS'
  | 'DEF_BRANCH_NON_EXHAUSTIVE'
  | 'DEF_BRANCH_UNREACHABLE_DEFAULT'
  | 'DEF_FORK_ARITY'
  | 'DEF_FORK_JOIN'
  | 'DEF_FORK_REGION'
  | 'DEF_FORK_NESTED'
  | 'DEF_JOIN_THRESHOLD'
  | 'DEF_CONSENSUS_CANDIDATE'
  | 'DEF_CONSENSUS_BOUND'
  | 'DEF_GATE_RESOLUTION';
type DefinitionFault = {
  readonly code: DefinitionFaultCode;
  readonly path: string;
  readonly message: string;
};
type PipelineCompilation =
  | { readonly ok: true; readonly pipeline: CompiledPipeline }
  | { readonly ok: false; readonly faults: readonly DefinitionFault[] };
```

`compilePipeline(definition: PipelineDefinition): PipelineCompilation` MUST copy all
retained input and recursively freeze successful output. Compiled data MUST contain only
portable JSON-compatible values: no `Map`, `Set`, function, symbol, `undefined`, class
instance, hash, generated ID, timestamp, host binding, or execution plan.

Nodes and facts MUST sort by key. Cases, branches, candidates, resolutions, and edges
MUST sort by semantic name and then target. Topological ties MUST sort by `NodeKey`.
All index offsets MUST be zero-based safe integers into the corresponding canonical
array; keys, endpoints, offsets, and sorted arrays MUST agree exactly.

## Definition validity

Keys and semantic names MUST be non-empty NFC strings of at most 64 Unicode code points
and MUST reject unpaired surrogates. Keys additionally MUST reject control characters,
`/`, and `~`. Scalar equality MUST be type-sensitive; strings MUST normalize to NFC,
numbers MUST be finite safe integers, and `-0` MUST normalize to `0`.

A branch case MUST use its node's one declared fact. Literal types MUST match the fact.
`oneOf` MUST contain 1–64 unique values. Case literal domains MUST be pairwise disjoint;
selection is not first-match. String and number domains MUST have a default. Boolean and
null domains MAY omit a default only when fully covered and MUST reject an unreachable
default.

Every fork MUST declare 2–32 uniquely named branches and exactly one reciprocal join.
V1 MUST reject nested forks, foreign joins, cross-branch edges, outside ingress, region
escape, and barrier bypass. Each exit MUST be a task whose four outcome edges target the
join. Those exit edges MUST compile as readiness edges. Fork-to-entry and fork-to-join
edges MUST compile as activation edges with outcome `forked`. The full graph, including
readiness edges, MUST be acyclic; every node MUST be reachable and lead to a terminal.

A threshold join count MUST be in `1..branchCount`. Consensus candidates MUST be unique
NFC names; each node MUST have 1–32 candidates. Quorum MUST be in
`1..candidateCount`. Each threshold bound MUST be in that range, and
`approve + reject` MUST exceed `candidateCount`. Human-gate resolutions MUST be unique
and non-empty.

## Limits, traversal, and diagnostics

| Input                                 |                 Maximum |
| ------------------------------------- | ----------------------: |
| nodes / compiled node facts           |                     256 |
| compiled edges                        |                   1,024 |
| declared facts / value facts          |                     128 |
| branch cases per node                 |                      64 |
| predicate values per case             |                      64 |
| fork branches per node                |                      32 |
| consensus candidates per node / total |              32 / 1,024 |
| gate resolutions per node / total     |              32 / 1,024 |
| key or semantic name                  |  64 Unicode code points |
| subject, outcome, or scalar string    | 512 Unicode code points |
| input depth / object own keys         |                  8 / 32 |
| visited input values                  |                  16,384 |
| RFC 6901 path / message               |  1,024 / 512 characters |
| canonical offending-value rendering   |          128 characters |
| returned faults                       |                     100 |

Collection inspection MUST stop at limit plus one sentinel. Traversal MUST stop when the
depth or visited-value limit is reached. Implementations MUST inspect own property
descriptors before values. Sparse arrays, accessors, symbols, non-enumerable properties,
custom prototypes, functions, `undefined`, fractional/unsafe/non-finite numbers, and
other non-plain values MUST reject without invoking getters or setters. Ordinary
JSON-compatible primitives, dense arrays, and plain objects are the portable input
contract. Proxies are outside that contract; a throwing proxy trap MAY propagate.

Definition faults MUST accumulate in phase order: shape, limits, local node, references,
regions, then DAG. Within a phase they MUST sort by RFC 6901 path in Unicode code-point
order and then code. Messages and rendered values MUST NOT affect ordering. When more
than 100 faults exist, the result MUST contain the first 99 plus a root `DEF_LIMIT`.

Compilation MUST be bounded `O(V + E)` plus bounded sorting. Recursion MUST NOT depend
on unbounded caller input depth.

## Exact planned root export manifest

The eventual root MUST export exactly these runtime values:

- `definePipeline`
- `compilePipeline`
- `decidePipeline`

It MUST export these types: `JsonScalar`, `NodeKey`, `FactKey`, `CandidateKey`,
`BranchName`, `ResolutionName`, `TaskOutcome`, `FactType`, `FactDefinition`,
`TaskRoutes`, `BranchPredicate`, `BranchCase`, `BranchDefault`, `ForkBranch`,
`AllJoinPolicy`, `AnyJoinPolicy`, `ThresholdJoinPolicy`, `JoinPolicy`, `JoinOutcome`,
`JoinRoutes`, `UnanimousConsensusPolicy`, `QuorumConsensusPolicy`,
`ThresholdConsensusPolicy`, `ConsensusPolicy`, `ConsensusOutcome`, `ConsensusRoutes`,
`HumanGateRoute`, `TaskNode`, `BranchNode`, `ForkNode`, `JoinNode`, `ConsensusNode`,
`HumanGateNode`, `TerminalNode`, `PipelineNode`, `PipelineDefinition`, `CompiledNode`,
`CompiledEdgeRole`, `CompiledEdge`, `CompiledForkBranch`, `CompiledForkRegion`,
`CompiledNodeIndexEntry`, `CompiledEdgeIndexEntry`, `CompiledPipeline`,
`DefinitionFaultCode`, `DefinitionFault`, `PipelineCompilation`, `NodeFact`,
`PipelineValueFact`, `CandidateVerdict`, `GateResolution`, `PipelineFacts`,
`ActivationCause`, `WaitReason`, `DecisionFaultCode`, `DecisionFault`,
`ActivateDecision`, `SelectDecision`, `WaitDecision`, `TerminalDecision`,
`NoopDecision`, `RejectDecision`, and `PipelineDecision`.

Limits, validators, comparators, fault-ordering helpers, and graph algorithms MUST NOT be
runtime exports.
