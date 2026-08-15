# Pipeline Program v1

- Status: Draft
- Version: 1.0.0-draft
- Target packages: `@revisium/revo-pipeline`, `@revisium/revo-pipeline/kernel`

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

## Scope

This specification defines the exact compiler result, linked Program IR, abstract
requirements, and provenance. It defines no exact executor binding or `ExecutionPlan`.
These contracts remain Draft; their unstable APIs are available from npm `alpha`
prereleases and local or CI-built tarballs without a compatibility guarantee. TypeBox schemas are authoritative
and MUST reject unknown fields, versions, kinds, and policies.

## Compiler result

```ts
type Digest = `sha256:${string}`;
type ProgramNodeId = Digest;

type PipelineCompileResult =
  | {
      readonly ok: true;
      readonly sourceDigest: Digest;
      readonly materializationDigest: Digest;
      readonly programDigest: Digest;
      readonly program: PipelineProgram;
      readonly requirements: ProgramRequirements;
      readonly provenance: ProgramProvenance;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly PipelineDiagnostic[];
    };

declare function compilePipeline(
  source: PipelineSourcePackage,
  materialization: ProfileMaterialization,
): PipelineCompileResult;
```

Compilation validates source and materialization, links, proves bounds/dataflow, lowers,
deduplicates requirements, canonicalizes, and hashes in that order. Failure returns no
partial program, requirements, provenance, or digest. Success MUST own and recursively
freeze new data without retaining or freezing caller objects. Its outer `sourceDigest`
and `materializationDigest` MUST equal the two pins inside `program`; `programDigest`
MUST equal Canonicalization v1 over exactly `{program,requirements,provenance}`.

## Public Program digest

```ts
type ProgramDigestInput = {
  readonly program: PipelineProgram;
  readonly requirements: ProgramRequirements;
  readonly provenance: ProgramProvenance;
};

declare function computeProgramDigest(value: ProgramDigestInput): Digest;
```

`computeProgramDigest` MUST own its input once, then apply the same complete pure Program
admission used by the compiler and kernel to that exact owned Program before checking
requirement/provenance cross-references or hashing. Admission covers the canonical module,
region, node, target, structured-node, selector/mapping, call-graph, cycle, depth, and
resource contracts in this specification. A call is structurally valid only when its
target exists, its output schema equals the target output schema, and its ordered outcome
keys equal the target root exits; call input mapping is validated by Program dataflow.
Source/materialization linking, source-level lowering proof, and provenance-to-source proof
remain compiler-contextual and are not reconstructed from Program IR.

Every invalid or hostile input MUST throw exactly
`TypeError('Invalid pipeline digest input.')`, without a cause or internal error text.
Successful hashing MUST not mutate caller data.

## Program envelope and regions

```ts
type PipelineProgram = {
  readonly schemaVersion: 'pipeline-program/v1';
  readonly key: string;
  readonly sourceDigest: Digest;
  readonly materializationDigest: Digest;
  readonly entryModule: string;
  readonly maximumTotalActivities: number;
  readonly modules: readonly [ProgramModule, ...ProgramModule[]];
};

type ProgramModule = {
  readonly key: string;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
  readonly region: ProgramRegion;
};

type ProgramRegion = {
  readonly id: ProgramNodeId;
  readonly inputSchema: ValueSchema;
  readonly entry: ProgramNodeId;
  readonly outputSchema: ValueSchema;
  readonly exits: readonly [ProgramRegionExit, ...ProgramRegionExit[]];
  readonly nodes: readonly [ProgramNode, ...ProgramNode[]];
};

type ProgramRegionExit = {
  readonly outcome: string;
  readonly outputSchema: ValueSchema;
};
```

An `end` exits its current region. An end in a module's top region returns a module
outcome. A called-module end returns to its caller. No nested end bypasses its parent
region. Every module top-region `inputSchema` is canonically equal to its module
`inputSchema`; all other region schemas are the normalized receiving schemas emitted by
the compiler.

Every Program region exit `outputSchema` MUST be accepted by its region `outputSchema`
under the Source v1 compatibility relation. Program admission enforces this rule for both
compiler output and host-supplied Program IR before kernel execution.

## Program selectors

```ts
type ProgramValueSelector =
  | { readonly kind: 'literal'; readonly value: JsonValue }
  | { readonly kind: 'moduleInput'; readonly pointer: JsonPointer }
  | { readonly kind: 'scopeInput'; readonly pointer: JsonPointer }
  | {
      readonly kind: 'nodeOutput';
      readonly nodeId: ProgramNodeId;
      readonly pointer: JsonPointer;
    }
  | {
      readonly kind: 'nodeFailure';
      readonly nodeId: ProgramNodeId;
      readonly pointer: JsonPointer;
    }
  | { readonly kind: 'regionOutput'; readonly pointer: JsonPointer }
  | {
      readonly kind: 'repeat';
      readonly value: 'iteration' | 'previousOutput';
      readonly pointer: JsonPointer;
    }
  | {
      readonly kind: 'map';
      readonly value: 'item' | 'itemKey';
      readonly pointer: JsonPointer;
    };
type ProgramValueMapping = Readonly<Record<string, ProgramValueSelector>>;

type ProgramRepeatCondition =
  | {
      readonly kind: 'equals';
      readonly selector: ProgramValueSelector;
      readonly value: JsonScalar;
    }
  | {
      readonly kind: 'oneOf';
      readonly selector: ProgramValueSelector;
      readonly values: readonly [JsonScalar, ...JsonScalar[]];
    }
  | { readonly kind: 'exists'; readonly selector: ProgramValueSelector }
  | {
      readonly kind: 'all';
      readonly conditions: readonly [
        ProgramRepeatCondition,
        ProgramRepeatCondition,
        ...ProgramRepeatCondition[],
      ];
    }
  | {
      readonly kind: 'any';
      readonly conditions: readonly [
        ProgramRepeatCondition,
        ProgramRepeatCondition,
        ...ProgramRepeatCondition[],
      ];
    }
  | { readonly kind: 'not'; readonly condition: ProgramRepeatCondition };
```

Selectors preserve Source v1 scope and compatibility rules. `scopeInput` reads the
immutable current-region input. `nodeOutput` reads only succeeded results;
`nodeFailure` reads only failed results on dominated failure routes. The compiler
replaces source keys with full program node IDs. No selector contains executable code.

The compiler-generated consensus participant schemas are exactly these normative
values; they are not additional package exports:

```ts
const VoteExitSchema = {
  type: 'object',
  properties: {
    vote: { type: 'string', enum: ['abstain', 'approve', 'reject'] },
  },
  required: ['vote'],
  additionalProperties: false,
} as const satisfies ValueSchema;

const ConsensusParticipantRegionOutputSchema = {
  anyOf: [VoteExitSchema, PipelineFailureValueSchema, EmptyObjectSchema],
} as const satisfies ValueSchema;
```

## Exact nine-kind IR union

```ts
type ProgramActivityNode = {
  readonly kind: 'activity';
  readonly id: ProgramNodeId;
  readonly activityKind: 'agent' | 'script' | 'effect';
  readonly requirementKey: string;
  readonly input: ProgramValueMapping;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
  readonly routes: {
    readonly succeeded: ProgramNodeId;
    readonly failed: ProgramNodeId;
    readonly cancelled: ProgramNodeId;
  };
};

type ProgramChoiceNode = {
  readonly kind: 'choice';
  readonly id: ProgramNodeId;
  readonly selector: ProgramValueSelector;
  readonly cases: readonly [
    { readonly key: string; readonly when: ChoiceDomain; readonly target: ProgramNodeId },
    ...{ readonly key: string; readonly when: ChoiceDomain; readonly target: ProgramNodeId }[],
  ];
  readonly otherwise: ProgramNodeId | null;
};

type ProgramCallNode = {
  readonly kind: 'call';
  readonly id: ProgramNodeId;
  readonly module: string;
  readonly input: ProgramValueMapping;
  readonly outputSchema: ValueSchema;
  readonly routes: {
    readonly outcomes: readonly [
      { readonly outcome: string; readonly target: ProgramNodeId },
      ...{ readonly outcome: string; readonly target: ProgramNodeId }[],
    ];
    readonly failed: ProgramNodeId;
    readonly cancelled: ProgramNodeId;
  };
};

type GenericParallelBranchResult =
  | {
      readonly status: 'completed';
      readonly outcome: string;
      readonly output: JsonValue;
    }
  | { readonly status: 'failed'; readonly failure: PipelineFailure }
  | { readonly status: 'cancelled' };
type GenericParallelOutput = {
  readonly classification: 'completed' | 'impossible' | 'failed' | 'cancelled';
  readonly branches: Readonly<Record<string, GenericParallelBranchResult>>;
};
type VoteParallelBranchResult =
  | { readonly status: 'vote'; readonly vote: 'approve' | 'reject' | 'abstain' }
  | { readonly status: 'failed'; readonly failure: PipelineFailure }
  | { readonly status: 'cancelled' };
type VoteParallelOutput = {
  readonly classification:
    'approved' | 'rejected' | 'inconclusive' | 'participantFailed' | 'cancelled';
  readonly votes: Readonly<Record<string, VoteParallelBranchResult>>;
};

type ProgramParallelBranch = {
  readonly key: string;
  readonly input: ProgramValueMapping;
  readonly region: ProgramRegion;
  readonly exits: readonly [
    RegionExitClassification<ParallelBranchClassification>,
    ...RegionExitClassification<ParallelBranchClassification>[],
  ];
};
type ProgramVoteBranch = {
  readonly key: string;
  readonly bindingKey: string;
  readonly input: ProgramValueMapping;
  readonly region: ProgramRegion;
};
type ProgramParallelNode =
  | {
      readonly kind: 'parallel';
      readonly id: ProgramNodeId;
      readonly mode: 'generic';
      readonly branches: readonly [
        ProgramParallelBranch,
        ProgramParallelBranch,
        ...ProgramParallelBranch[],
      ];
      readonly policy: ParallelPolicy;
      readonly remaining: 'drain' | 'cancel';
      readonly next: ProgramNodeId;
    }
  | {
      readonly kind: 'parallel';
      readonly id: ProgramNodeId;
      readonly mode: 'votes';
      readonly branches: readonly [ProgramVoteBranch, ...ProgramVoteBranch[]];
      readonly policy: ConsensusPolicy;
      readonly remaining: 'drain' | 'cancel';
      readonly next: ProgramNodeId;
    };

type ProgramRepeatNode = {
  readonly kind: 'repeat';
  readonly id: ProgramNodeId;
  readonly maximumIterations: number;
  readonly initialInput: ProgramValueMapping;
  readonly nextInput: ProgramValueMapping;
  readonly body: ProgramRegion;
  readonly bodyExits: readonly [
    RegionExitClassification<'value' | 'failed' | 'cancelled'>,
    ...RegionExitClassification<'value' | 'failed' | 'cancelled'>[],
  ];
  readonly continueWhen: ProgramRepeatCondition;
  readonly output: ProgramValueMapping;
  readonly outputSchema: ValueSchema;
  readonly routes: {
    readonly completed: ProgramNodeId;
    readonly exhausted: ProgramNodeId;
    readonly failed: ProgramNodeId;
    readonly cancelled: ProgramNodeId;
  };
};

type ProgramMapNode = {
  readonly kind: 'map';
  readonly id: ProgramNodeId;
  readonly items: ProgramValueSelector;
  readonly itemKeyPointer: JsonPointer;
  readonly maximumItems: number;
  readonly maximumConcurrency: number;
  readonly bodyInput: ProgramValueMapping;
  readonly body: ProgramRegion;
  readonly bodyExits: readonly [
    RegionExitClassification<'completed' | 'failed' | 'cancelled'>,
    ...RegionExitClassification<'completed' | 'failed' | 'cancelled'>[],
  ];
  readonly failure:
    | { readonly kind: 'collect' }
    | { readonly kind: 'failFast'; readonly remaining: 'drain' | 'cancel' };
  readonly routes: {
    readonly completed: ProgramNodeId;
    readonly failed: ProgramNodeId;
    readonly cancelled: ProgramNodeId;
  };
};

type ProgramWaitNode = {
  readonly kind: 'wait';
  readonly id: ProgramNodeId;
  readonly wait:
    | { readonly kind: 'duration'; readonly durationMs: number }
    | {
        readonly kind: 'signal';
        readonly signal: string;
        readonly payloadSchema: ValueSchema | null;
      };
  readonly routes: {
    readonly completed: ProgramNodeId;
    readonly cancelled: ProgramNodeId;
  };
};

type ProgramHumanGateNode = {
  readonly kind: 'humanGate';
  readonly id: ProgramNodeId;
  readonly subject: string;
  readonly answers: readonly [string, ...string[]];
  readonly authorizationRequirements: readonly string[];
  readonly routes: {
    readonly answers: readonly [
      { readonly answer: string; readonly target: ProgramNodeId },
      ...{ readonly answer: string; readonly target: ProgramNodeId }[],
    ];
    readonly conflict: ProgramNodeId;
    readonly deadline: ProgramNodeId;
    readonly cancelled: ProgramNodeId;
  };
};

type ProgramEndNode = {
  readonly kind: 'end';
  readonly id: ProgramNodeId;
  readonly outcome: string;
  readonly output: ProgramValueMapping;
};

type ProgramNode =
  | ProgramActivityNode
  | ProgramChoiceNode
  | ProgramCallNode
  | ProgramParallelNode
  | ProgramRepeatNode
  | ProgramMapNode
  | ProgramWaitNode
  | ProgramHumanGateNode
  | ProgramEndNode;
```

These are exactly nine IR kinds. `agent`, `script`, `effect`, `consensus`, `sequence`,
`aggregation`, `plugin`, `fork`, `join`, `task`, and `terminal` MUST be rejected.

An activity has exactly three terminal statuses: `succeeded`, `failed`, and `cancelled`.
Domain outcomes are successful output data consumed by `choice`. An executor-reported
fourth status is an `EVENT_EXECUTOR_OUTCOME` protocol rejection.

## Parallel and consensus lowering

A generic parallel produces an output classification from `completed`, `impossible`,
`failed`, and `cancelled`; its `next` MUST be one compiler-emitted choice that alone
routes those values to the source targets. Branch author outcomes map through the fixed
internal `qualifies | doesNotQualify | failed | cancelled` classifications.
That choice has exact cases, in Unicode order, `cancelled`, `completed`, `failed`, and
`impossible`; each case key and equality value is the classification name and
`otherwise` is null. It has lowering role `genericParallelChoice`, ordinal `0`, null
materialization path, and is never the target entry for the source parallel.
Its exact output is `GenericParallelOutput`. Every declared branch key MUST be present:
an exit classified `qualifies` or `doesNotQualify` stores
`{status:'completed',outcome,output}`; an exit classified `failed` validates its exact
`PipelineFailure` output and stores `{status:'failed',failure}`; cleanup or region
cancellation stores `{status:'cancelled'}`. Its schema is compiler-derived.

`all` completes when every branch qualifies and becomes impossible on the first
does-not-qualify result. `any` completes on the first qualifying result and becomes
impossible when no pending branch can qualify. `threshold(n)` completes at `n`
qualifying branches and becomes impossible when `qualified + pending < n`. A branch
classified failed selects `failed`; a branch classified cancelled before region
cancellation selects `failed`. The parallel `cancelled` result is reserved for
cancellation of the whole parallel region.

A vote parallel has one branch and exactly one agent activity per participant. Each
participant activity's successful output schema is the enum
`approve | reject | abstain`. Its closed policy
classifies exactly `approved`, `rejected`, `inconclusive`, `participantFailed`, or
`cancelled`; its `next` MUST be the one compiler-emitted choice that routes those values.
That choice has exact cases, in Unicode order, `approved`, `cancelled`, `inconclusive`,
`participantFailed`, and `rejected`; every key/equality value is the classification name
and `otherwise` is null.
Its exact output is `VoteParallelOutput`. Every participant key MUST be present as
`vote`, `failed`, or `cancelled`; null and missing entries are forbidden. Its schema is
compiler-derived.

Every vote branch has one required `input` mapping evaluated in the enclosing region
scope. It constructs the complete child branch `scopeInput` and MUST be statically
compatible with `branch.region.inputSchema`. The branch's one participant activity MUST
consume that child scope by exact identity: for every property constructed by
`branch.input`, its activity input has the same property with a `scopeInput` selector at
that property's escaped RFC 6901 pointer, and it has no other property. The branch region
and participant activity input schemas MUST be canonically equal. The participant
activity output schema is the exact closed string enum `approve | reject | abstain`;
the branch result copies that value without coercion or status inference.

For a slot-selected consensus, every branch `key` is the materialized participant key,
`bindingKey` is that participant's exact abstract binding key, `input` is the lowered
agent-slot source input mapping, and both input schemas equal the slot's `inputSchema`.
The slot's author `outputSchema` applies only to its `single` strategy; consensus
participant output remains the fixed vote schema. For explicit consensus, the branch
key, binding key, input mapping, and input schema come from that exact fixed source
participant. In both forms, the branch activity MUST reference an agent requirement
whose `bindingKey` and input/output schemas equal those branch rules. Global identical
requirement deduplication remains allowed; a participant binding may never be borrowed
from another branch.

Every generated agent requirement is exactly
`{kind:'agent',key:bindingKey,bindingKey,inputSchema,outputSchema}`. Slot-consensus
requirement source provenance is the owning agent node; explicit-consensus requirement
source provenance is the exact participant record. For slot index `s`, aggregate
parallel/choice materialization provenance is `/slots/{s}/selection`, single activity
and requirement provenance is `/slots/{s}/selection/participant`, and each participant
region/activity/end plus requirement provenance is
`/slots/{s}/selection/participants/{i}`. Explicit-consensus materialization paths are
all null.

Participants normalize by Unicode code-point order before lowering; `i` below is their
zero-based position in that order. Every `ProgramVoteBranch.region` has exactly:

- `inputSchema` equal to that participant's input schema;
- `entry` equal to its participant activity ID;
- `outputSchema: ConsensusParticipantRegionOutputSchema`;
- three exits with outcomes `vote`, `failed`, and `cancelled`, whose output schemas are
  exactly `VoteExitSchema`, `PipelineFailureValueSchema`, and `EmptyObjectSchema`;
- one agent activity plus three end nodes, with `nodes` stored in full Program node-ID
  order rather than role or creation order.

The participant activity uses the identity input described above, the exact participant
agent requirement, and scalar output schema
`{type:'string',enum:['abstain','approve','reject']}`. Its routes target the vote end on
`succeeded`, failed end on `failed`, and cancelled end on `cancelled`. The generated end
mappings are exactly:

```ts
voteEnd.output = {
  vote: { kind: 'nodeOutput', nodeId: participantActivityId, pointer: '' },
};
failedEnd.output = {
  code: { kind: 'nodeFailure', nodeId: participantActivityId, pointer: '/code' },
  path: { kind: 'nodeFailure', nodeId: participantActivityId, pointer: '/path' },
};
cancelledEnd.output = {};
```

The ends select region outcomes `vote`, `failed`, and `cancelled`, respectively. After
exact exit-schema validation, the vote parallel converts them without loss to
`{status:'vote',vote:output.vote}`, `{status:'failed',failure:output}`, or
`{status:'cancelled'}`. It MUST NOT derive a vote from activity status, synthesize a
failure path, or expose the wrapper object in `VoteParallelOutput`.

Unanimous rejects on the first reject, approves when all approve, and is inconclusive
after all finish with no reject and at least one abstain. Quorum waits for all branches,
uses `approve + reject` as participation, is inconclusive below minimum or on a tie, and
otherwise chooses the larger vote count. Independent thresholds decide as soon as one
threshold is met and are inconclusive when neither remains reachable. Mutual-exclusion
validation makes reject dominance forbidden and unnecessary.

Participant activity failure or isolated cancellation is `participantFailed` and not a
vote. The vote parallel becomes `cancelled` only when its whole region is cancelled.
After any decisive result, `drain` waits for remaining branches; `cancel` enters a
nonterminal cancelling phase and requests/awaits their cancellation. In either mode,
the parallel cannot complete until every declared branch has a terminal result, so an
early decision never produces a partial output record. Vote policy classification uses
the complete terminal record and the already selected deterministic early decision.

## Repeat, map, wait, gate, and call semantics

Repeat evaluates its condition only after a `value` body exit. False chooses
`completed`. True starts the next iteration when below the bound. True at the bound
chooses `exhausted`, never a machine invariant fault. A body exit classified `failed`
must output exact `PipelineFailureValueSchema`; repeat retains and propagates that full
failure on its failed route.

Map routes exactly `completed`, `failed`, or `cancelled`. In collect mode, completed and
failed item records are retained in canonical item-key order and the map may complete
with failures recorded. In fail-fast mode, the first failed item selects `failed` and
applies its remaining-work policy. Item cleanup cancellation does not select the map's
`cancelled` route; only whole-map cancellation does.
Its exact compiler-derived output is `{items}` with item records
`{itemKey,status,output,errorCode}` matching Machine v1.
`errorCode` is a derived author-facing projection of the retained failure's `code`; the
machine result keeps the full `PipelineFailure` and fail-fast propagation preserves it.
A map-body exit classified `failed` must output exact `PipelineFailureValueSchema` and
becomes that item's retained failure.

Both `maximumItems` and `maximumConcurrency` are bounded by 1,024, and concurrency is no
greater than `max(1, maximumItems)`. Before creating a map owner or item frame, the
kernel MUST validate the complete selected array, its bound, every item key, key
uniqueness, every body mapping, and every constructed body input. Failure precedence is
items selector, array shape/bound, item key pointer/type/duplicate, body mapping, then
body schema; within one phase the lowest input index and then mapping key wins. A
preflight failure creates no map work.

Duration wait schema/output is `null`. A signal whose payload schema is null accepts
only `payload:null` and produces `null`; otherwise it produces the exact validated
signal payload. Runtime missing data or schema mismatch is a machine DATA fault, never
an exception.

A human gate contains no arbitration policy or caller-defined output schema. The host
supplies an explicit answer, conflict, or deadline resolution after auth/arbitration;
the node output is exactly that closed resolution object. `gateCancelled` is distinct
and selects the cancelled route. A Program human gate's `answers` and answer-route keys
MUST be unique, equal keyed sets normalized by Unicode code point. A malformed admitted
Program with a duplicate, missing, or extra answer route is `PROGRAM_INVALID`; runtime
input outside the admitted set remains `EVENT_GATE_ANSWER`.

Calls are linked module frames, not host-dispatched subpipeline activities. All module
routes are exhaustive. The call graph is acyclic and depth-bounded.

## Exact requirements

```ts
type AgentProgramRequirement = {
  readonly kind: 'agent';
  readonly key: string;
  readonly bindingKey: string;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
};
type ScriptProgramRequirement = {
  readonly kind: 'script';
  readonly key: string;
  readonly script: { readonly key: string; readonly revision: number };
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
};
type EffectProgramRequirement = {
  readonly kind: 'effect';
  readonly key: string;
  readonly effectKey: string;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
};
type ProgramRequirement =
  AgentProgramRequirement | ScriptProgramRequirement | EffectProgramRequirement;
type ProgramRequirements = {
  readonly schemaVersion: 'pipeline-requirements/v1';
  readonly entries: readonly ProgramRequirement[];
};
```

Every activity references exactly one requirement. Every requirement is referenced.
Entries sort by key. Equal keys with canonically identical declarations deduplicate to
one entry; equal keys with different declarations fail `REQUIREMENT_CONFLICT`. Exact
assemblies, roles, skills, tools, permissions, models, providers, runners, retry/timeout
policies, workspace, and secrets MUST NOT appear.

## Exact provenance and synthesized IDs

```ts
type LoweringRole =
  | 'direct'
  | 'genericParallelChoice'
  | 'agentSingleActivity'
  | 'consensusParallel'
  | 'consensusParticipantRegion'
  | 'consensusParticipantActivity'
  | 'consensusParticipantExit'
  | 'consensusChoice';
type NodeProvenance = {
  readonly programNodeId: ProgramNodeId;
  readonly sourcePath: JsonPointer;
  readonly materializationPath: JsonPointer | null;
  readonly loweringRole: LoweringRole;
  readonly ordinal: number;
};
type RequirementProvenance = {
  readonly requirementKey: string;
  readonly sourcePaths: readonly [JsonPointer, ...JsonPointer[]];
  readonly materializationPaths: readonly JsonPointer[];
};
type ProgramProvenance = {
  readonly schemaVersion: 'pipeline-provenance/v1';
  readonly nodes: readonly NodeProvenance[];
  readonly requirements: readonly RequirementProvenance[];
};
```

`ProgramProvenance.nodes` contains exactly one record for every program region and every
program node; `programNodeId` stores the region ID for a region record. No emitted
structural ID may lack provenance.

Every region and node ID MUST be the complete lowercase SHA-256 digest produced with the
Canonicalization v1 domain `pipeline-ir-id/v1` over exactly:

```ts
{
  sourcePath: JsonPointer,
  loweringRole: LoweringRole,
  ordinal: number,
}
```

No hash truncation, random ID, timestamp, path alias, or array position outside
`ordinal` is allowed. `ordinal` is a zero-based safe integer assigned in canonical
lowering-role order. Any duplicate generated ID, including an implementation duplicate
of the same tuple, fails `LOWERING_ID_COLLISION`. Conformance MUST pin full digest golden
vectors.

Consensus lowering uses the owning source agent/consensus node path for every generated
tuple. The parallel and choice use ordinal `0`. For participant `i` in Unicode
code-point key order, its region and activity each use ordinal `i`; its vote, failed,
and cancelled ends use `consensusParticipantExit` ordinals `3*i`, `3*i+1`, and `3*i+2`.
The participant region and all four contained nodes have provenance. For explicit
consensus their `materializationPath` is `null`. For a slot-selected consensus, the
region, activity, and all three ends use that participant's exact canonical path in the
materialization; they MUST NOT use a sibling participant or only the enclosing slot
path. Region exits normalize by Unicode outcome order, and region nodes normalize by
full generated ID; neither storage order changes the assigned ordinals.

Each source route target resolves to exactly one entry ID: single agent targets the
`agentSingleActivity` ordinal `0`; either consensus form targets `consensusParallel`
ordinal `0`; source parallel targets its `direct` parallel ordinal `0`; every other
source kind targets its `direct` ordinal `0`. Generated generic-parallel and consensus
choices are routing-only and are never target entries.

Provenance arrays sort by program node ID or requirement key; path arrays sort by Unicode
code point. Provenance MUST NOT contain local paths, timestamps, prompts, secret values,
executor data, or free-form source excerpts.

## Dataflow, faults, and portability

Schema projection and compatibility are exactly Source v1. Compile-time missing pointer,
scope, dominance, or compatibility failures use `DATA_POINTER_STATIC`, `DATA_SCOPE`,
`DATA_DOMINANCE`, or `DATA_SCHEMA_INCOMPATIBLE`. Runtime missing pointers use
`DATA_POINTER_MISSING`. A runtime mapped child-input schema mismatch becomes the owning
call/repeat/map node's failed result, or the exact generic/vote parallel branch's failed
result, before declared routing/classification. It creates no child frame and never
throws. Top-region input mismatch remains an initialization failure.

Every Program region exit referenced by a `failed` classification MUST have schema
exactly `PipelineFailureValueSchema`; otherwise admitted Program validation fails with
`PROGRAM_INVALID`. At runtime its value MUST have exactly `code` and a semantically
valid `JsonPointer` `path`. Malformed values become
`{code:'DATA_SCHEMA_MISMATCH',path:''}` at the owning node; a valid failure is copied
unchanged through branch, vote, repeat, call, map, and final state propagation.
`nodeFailure` always reads the retained exact object. If deterministic internal progress
produces multiple failures in one transition, the lowest canonical branch/item/node key
selects the propagated failure. If failures arrive in different events, the first valid
event selects it and later events cannot replace it.

Other stable compile codes include `LINK_MODULE_MISSING`, `LINK_RECURSION`,
`BOUND_OVERFLOW`, `BOUND_EXCEEDED`, `REQUIREMENT_MISSING`, `REQUIREMENT_UNUSED`,
`REQUIREMENT_CONFLICT`, `DATA_FAILED_EXIT_SCHEMA`, `LOWERING_ID_COLLISION`, and
`CANONICAL_INPUT`. Codes remain in the diagnostic families defined by Source v1.

After lowering and before emitting requirements, provenance, or a digest, compilation
MUST apply the shared Program/Machine admission analysis. The exact caps are 4,096
Program nodes, 4,096 regions, 16,384 targets, nesting and call depth 32, 65,536
synchronous work units, 16,384 live frames and operations, 65,536 total live node
results and cancellation memberships, 262,144 structural collection slots, and
1,048,576 serialized state or command JSON value occurrences. Only the first exceeded
cap in structural, work, live-resource, membership, and JSON-value order produces one
`BOUND_EXCEEDED`; failure emits no partial bundle or `programDigest`.

Successful output MUST be portable, recursively frozen, deterministic, and valid after a
JSON round trip. Compilation MUST not read environment state or expose rejected values
in diagnostics. All bound arithmetic checks overflow before addition/multiplication.
