# Pipeline Source v1

- Status: Draft
- Version: 1.0.0-draft
- Target package: `@revisium/revo-pipeline`

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

## Scope

This specification defines the complete public source-language document. The schemas
and API remain Draft and unavailable from the package root while conformance is
incomplete. TypeBox schemas are the runtime source of truth; the exact static shapes
below MUST be derived from them. Every object schema MUST use
`additionalProperties: false`. Unknown fields, versions, and union kinds MUST be
rejected.

## Portable values and schema dialect

```ts
type JsonScalar = null | boolean | number | string;
type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };
type JsonPointer = '' | `/${string}`;

type ValueSchema =
  | { readonly type: 'null' }
  | { readonly type: 'boolean' }
  | {
      readonly type: 'integer';
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | {
      readonly type: 'number';
      readonly minimum?: number;
      readonly maximum?: number;
    }
  | {
      readonly type: 'string';
      readonly enum?: readonly string[];
      readonly minLength?: number;
      readonly maxLength?: number;
    }
  | {
      readonly type: 'array';
      readonly items: ValueSchema;
      readonly minItems?: number;
      readonly maxItems?: number;
    }
  | {
      readonly type: 'object';
      readonly properties: Readonly<Record<string, ValueSchema>>;
      readonly required: readonly string[];
      readonly additionalProperties: false;
    }
  | { readonly anyOf: readonly [ValueSchema, ValueSchema, ...ValueSchema[]] };
```

This is the entire v1 schema algebra. `$ref`, `allOf`, `oneOf`, `not`, conditional
schemas, patterns, formats, tuple arrays, property-name schemas, defaults, coercion, and
custom TypeBox kinds MUST NOT appear in a public artifact. `anyOf` alternatives MUST be
pairwise non-identical after canonicalization.

All strings, keys, enum members, and JSON Pointer tokens MUST be NFC and reject unpaired
surrogates. Identifiers MUST contain 1–64 Unicode code points and reject controls, `/`,
and `~`. Display strings MUST contain at most 512 code points. Numbers MUST be finite
safe integers; `-0` MUST normalize to `0`. Source-envelope objects MUST have at most 64
own keys. Source-envelope arrays use their explicit bound where one is declared and
otherwise have at most 1,024 items. Region and RepeatCondition structural nesting MUST
not exceed 32, and a ValueSchema tree MUST not exceed depth 16. The portable-value
limits apply only at embedded JsonValue positions; their 65,536 visited-value allowance
is cumulative across the package rather than restarted per literal. A valid source
envelope may therefore exceed the general standalone portable-value depth or visited-
value limits outside those embedded positions. Accessors, symbols, sparse arrays, custom
prototypes, functions, and `undefined` MUST be rejected without invoking getters.

## Selectors, mappings, conditions, and targets

```ts
type ValueSelector =
  | { readonly kind: 'literal'; readonly value: JsonValue }
  | { readonly kind: 'moduleInput'; readonly pointer: JsonPointer }
  | { readonly kind: 'scopeInput'; readonly pointer: JsonPointer }
  | {
      readonly kind: 'nodeOutput';
      readonly node: string;
      readonly pointer: JsonPointer;
    }
  | {
      readonly kind: 'nodeFailure';
      readonly node: string;
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

type ValueMapping = Readonly<Record<string, ValueSelector>>;
type PipelineFailure = {
  readonly code: string;
  readonly path: JsonPointer;
};

type ChoiceDomain =
  | { readonly kind: 'equals'; readonly value: JsonScalar }
  | {
      readonly kind: 'oneOf';
      readonly values: readonly [JsonScalar, ...JsonScalar[]];
    };

type RepeatCondition =
  | {
      readonly kind: 'equals';
      readonly selector: ValueSelector;
      readonly value: JsonScalar;
    }
  | {
      readonly kind: 'oneOf';
      readonly selector: ValueSelector;
      readonly values: readonly [JsonScalar, ...JsonScalar[]];
    }
  | { readonly kind: 'exists'; readonly selector: ValueSelector }
  | {
      readonly kind: 'all';
      readonly conditions: readonly [RepeatCondition, RepeatCondition, ...RepeatCondition[]];
    }
  | {
      readonly kind: 'any';
      readonly conditions: readonly [RepeatCondition, RepeatCondition, ...RepeatCondition[]];
    }
  | { readonly kind: 'not'; readonly condition: RepeatCondition };
```

The following exact closed schema values are normative vocabulary used by source
validation and compiler-generated Program regions; they are not additional package
exports:

```ts
const EmptyObjectSchema = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} as const satisfies ValueSchema;

const PipelineFailureValueSchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    path: { type: 'string' },
  },
  required: ['code', 'path'],
  additionalProperties: false,
} as const satisfies ValueSchema;
```

`PipelineFailureValueSchema` additionally requires `path` to pass exact `JsonPointer`
semantic validation; the schema algebra deliberately has no public format keyword.

Choice case domains MUST be pairwise disjoint under type-sensitive canonical scalar
equality. `oneOf` values MUST be unique. Every choice MUST contain an explicit
`otherwise` target or `null`; `null` is valid only when the selector schema is a closed
finite domain fully covered by cases. A choice MUST select exactly one case or otherwise.

`regionOutput` is valid only in a containing structured node after a child region exits.
`repeat` selectors are valid only inside the repeat body or its condition/mappings.
`map` selectors are valid only inside the map body. All selectors are read-only.

## Source envelope and regions

```ts
type PipelineSourcePackage = {
  readonly schemaVersion: 'pipeline-source/v1';
  readonly key: string;
  readonly entryModule: string;
  readonly maximumTotalActivities: number;
  readonly modules: readonly [PipelineSourceModule, ...PipelineSourceModule[]];
};

type PipelineSourceModule = {
  readonly key: string;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
  readonly region: SourceRegion;
};

type SourceRegion = {
  readonly key: string;
  readonly inputSchema?: ValueSchema;
  readonly entry: string;
  readonly outputSchema: ValueSchema;
  readonly exits: readonly [SourceRegionExit, ...SourceRegionExit[]];
  readonly nodes: readonly [SourceNode, ...SourceNode[]];
};

type SourceRegionExit = {
  readonly outcome: string;
  readonly outputSchema: ValueSchema;
};
```

An omitted region `inputSchema` normalizes to the canonical empty closed object schema
`{type:'object',properties:{},required:[],additionalProperties:false}`. A Program region
always contains the normalized field. A module's top region `inputSchema` MUST equal the
module `inputSchema`; therefore it may omit the field only when the module input is that
canonical empty object.

An `end` exits its immediately containing region. Its outcome MUST name exactly one of
that region's exits and its output mapping MUST satisfy that exit schema. Exiting the top
module region produces the module outcome/output. A structured parent consumes child
region exits; a child `end` never terminates the whole pipeline directly.

Each region MUST have one reachable entry, unique node keys and exit outcomes, no
unreachable node, and no path that can avoid an exit outside declared repeat/map bounds.
Every target resolves inside the current region. Calls resolve modules in the package.

## Exact source node union

```ts
type ActivityRoutes = {
  readonly succeeded: string;
  readonly failed: string;
  readonly cancelled: string;
};

type ConsensusRoutes = {
  readonly approved: string;
  readonly rejected: string;
  readonly inconclusive: string;
  readonly participantFailed: string;
  readonly cancelled: string;
};
type SingleAgentStrategy = {
  readonly kind: 'single';
  readonly routes: ActivityRoutes;
};
type ConsensusAgentStrategy = {
  readonly kind: 'consensus';
  readonly minimumParticipants: number;
  readonly maximumParticipants: number;
  readonly policy: ConsensusPolicy;
  readonly remaining: 'drain' | 'cancel';
  readonly routes: ConsensusRoutes;
};
type AgentSlotStrategy = SingleAgentStrategy | ConsensusAgentStrategy;

type ConsensusPolicy =
  | { readonly kind: 'unanimous' }
  | { readonly kind: 'quorum'; readonly minimumParticipation: number }
  | {
      readonly kind: 'independentThreshold';
      readonly approveThreshold: number;
      readonly rejectThreshold: number;
    };

type AgentSourceNode = {
  readonly kind: 'agent';
  readonly key: string;
  readonly slotKey: string;
  readonly strategies: readonly [AgentSlotStrategy, ...AgentSlotStrategy[]];
  readonly input: ValueMapping;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
};

type ScriptSourceNode = {
  readonly kind: 'script';
  readonly key: string;
  readonly requirementKey: string;
  readonly script: { readonly key: string; readonly revision: number };
  readonly input: ValueMapping;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
  readonly routes: ActivityRoutes;
};

type EffectSourceNode = {
  readonly kind: 'effect';
  readonly key: string;
  readonly requirementKey: string;
  readonly effectKey: string;
  readonly input: ValueMapping;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
  readonly routes: ActivityRoutes;
};

type ChoiceSourceNode = {
  readonly kind: 'choice';
  readonly key: string;
  readonly selector: ValueSelector;
  readonly cases: readonly [
    { readonly key: string; readonly when: ChoiceDomain; readonly target: string },
    ...{ readonly key: string; readonly when: ChoiceDomain; readonly target: string }[],
  ];
  readonly otherwise: string | null;
};

type ParallelBranchClassification = 'qualifies' | 'doesNotQualify' | 'failed' | 'cancelled';
type RegionExitClassification<T extends string> = {
  readonly outcome: string;
  readonly classification: T;
};
type ParallelSourceBranch = {
  readonly key: string;
  readonly input: ValueMapping;
  readonly region: SourceRegion;
  readonly exits: readonly [
    RegionExitClassification<ParallelBranchClassification>,
    ...RegionExitClassification<ParallelBranchClassification>[],
  ];
};
type ParallelPolicy =
  | { readonly kind: 'all' }
  | { readonly kind: 'any' }
  | { readonly kind: 'threshold'; readonly count: number };
type ParallelRoutes = {
  readonly completed: string;
  readonly impossible: string;
  readonly failed: string;
  readonly cancelled: string;
};
type ParallelSourceNode = {
  readonly kind: 'parallel';
  readonly key: string;
  readonly branches: readonly [
    ParallelSourceBranch,
    ParallelSourceBranch,
    ...ParallelSourceBranch[],
  ];
  readonly policy: ParallelPolicy;
  readonly remaining: 'drain' | 'cancel';
  readonly routes: ParallelRoutes;
};

type RepeatSourceNode = {
  readonly kind: 'repeat';
  readonly key: string;
  readonly maximumIterations: number;
  readonly initialInput: ValueMapping;
  readonly nextInput: ValueMapping;
  readonly body: SourceRegion;
  readonly bodyExits: readonly [
    RegionExitClassification<'value' | 'failed' | 'cancelled'>,
    ...RegionExitClassification<'value' | 'failed' | 'cancelled'>[],
  ];
  readonly continueWhen: RepeatCondition;
  readonly output: ValueMapping;
  readonly outputSchema: ValueSchema;
  readonly routes: {
    readonly completed: string;
    readonly exhausted: string;
    readonly failed: string;
    readonly cancelled: string;
  };
};

type MapSourceNode = {
  readonly kind: 'map';
  readonly key: string;
  readonly items: ValueSelector;
  readonly itemKeyPointer: JsonPointer;
  readonly maximumItems: number;
  readonly maximumConcurrency: number;
  readonly bodyInput: ValueMapping;
  readonly body: SourceRegion;
  readonly bodyExits: readonly [
    RegionExitClassification<'completed' | 'failed' | 'cancelled'>,
    ...RegionExitClassification<'completed' | 'failed' | 'cancelled'>[],
  ];
  readonly failure:
    | { readonly kind: 'collect' }
    | { readonly kind: 'failFast'; readonly remaining: 'drain' | 'cancel' };
  readonly routes: {
    readonly completed: string;
    readonly failed: string;
    readonly cancelled: string;
  };
};

type WaitSourceNode = {
  readonly kind: 'wait';
  readonly key: string;
  readonly wait:
    | { readonly kind: 'duration'; readonly durationMs: number }
    | {
        readonly kind: 'signal';
        readonly signal: string;
        readonly payloadSchema: ValueSchema | null;
      };
  readonly routes: { readonly completed: string; readonly cancelled: string };
};

type HumanGateSourceNode = {
  readonly kind: 'humanGate';
  readonly key: string;
  readonly subject: string;
  readonly answers: readonly [string, ...string[]];
  readonly authorizationRequirements: readonly string[];
  readonly routes: {
    readonly answers: readonly [
      { readonly answer: string; readonly target: string },
      ...{ readonly answer: string; readonly target: string }[],
    ];
    readonly conflict: string;
    readonly deadline: string;
    readonly cancelled: string;
  };
};

type ExplicitConsensusParticipant = {
  readonly key: string;
  readonly bindingKey: string;
  readonly input: ValueMapping;
  readonly inputSchema: ValueSchema;
};
type ConsensusSourceNode = {
  readonly kind: 'consensus';
  readonly key: string;
  readonly participants: readonly [
    ExplicitConsensusParticipant,
    ExplicitConsensusParticipant,
    ...ExplicitConsensusParticipant[],
  ];
  readonly policy: ConsensusPolicy;
  readonly remaining: 'drain' | 'cancel';
  readonly routes: ConsensusRoutes;
};

type CallSourceNode = {
  readonly kind: 'call';
  readonly key: string;
  readonly module: string;
  readonly input: ValueMapping;
  readonly outputSchema: ValueSchema;
  readonly routes: {
    readonly outcomes: readonly [
      { readonly outcome: string; readonly target: string },
      ...{ readonly outcome: string; readonly target: string }[],
    ];
    readonly failed: string;
    readonly cancelled: string;
  };
};

type EndSourceNode = {
  readonly kind: 'end';
  readonly key: string;
  readonly outcome: string;
  readonly output: ValueMapping;
};

type SourceNode =
  | AgentSourceNode
  | ScriptSourceNode
  | EffectSourceNode
  | ChoiceSourceNode
  | ParallelSourceNode
  | RepeatSourceNode
  | MapSourceNode
  | WaitSourceNode
  | HumanGateSourceNode
  | ConsensusSourceNode
  | CallSourceNode
  | EndSourceNode;
```

These are exactly the 12 source kinds. `sequence`, `aggregation`, `plugin`, `fork`,
`join`, `task`, and `terminal` MUST be rejected. Control flow is targets plus nested
regions; array position MUST NOT imply sequence.

## Node semantics and validation

An activity terminates only as `succeeded`, `failed`, or `cancelled`. A custom domain
value MUST be carried in successful output and interpreted by a following `choice`.
Executor-reported custom terminal statuses are protocol errors, not source outcomes.
Every activity input mapping MUST validate against its declared input schema before a
requirement or command is emitted.

An agent node is a slot. Strategy kinds MUST be unique. Each strategy owns its exact
route shape. A consensus strategy MUST declare its exact policy and participant range;
materialization selects no policy or routes. The range MUST satisfy
`1 <= minimumParticipants <= maximumParticipants <= 32`. Quorum minimum
participation MUST be positive and no greater than `minimumParticipants`. Independent
thresholds MUST be positive; each MUST be no greater than `minimumParticipants`, and
their sum MUST exceed `maximumParticipants`. Thus the policy is reachable and mutually
exclusive for every allowed materialized count.

The slot `input` mapping MUST statically construct an object compatible with its
`inputSchema` in the containing region scope. A `single` lowering applies that mapping
to its activity directly. A consensus lowering applies it once per selected participant
as the child branch input; the participant activity then receives the branch scope by
identity. The slot `outputSchema` is the single-strategy activity output schema and does
not replace the fixed consensus vote schema.

Explicit consensus owns 2–32 fixed abstract participant binding keys. A successful
participant output MUST validate as exactly `approve`, `reject`, or `abstain`. A failed
participant, or a participant cancelled before the region itself is cancelled, produces
`participantFailed`; it is not a vote. The consensus `cancelled` route is reserved for
cancellation of the enclosing consensus region.
Quorum minimum participation MUST be in `1..participantCount`. Independent thresholds
MUST each be in that range and their sum MUST exceed participant count.
Each explicit participant's `input` MUST statically construct an object compatible with
that participant's `inputSchema` in the consensus node's containing scope. Lowering uses
that mapping as the child branch input and an exact identity mapping from child scope to
the participant activity; it MUST NOT evaluate the original parent-scope mapping again
inside the child.

Every structured child exit MUST appear exactly once in its parent's exit-classification
array and no foreign outcome may appear. Source authors keep their own exit outcome
names; only the mapping uses the fixed internal classifications. An author-facing branch
is never forced to name an outcome `qualifies`.

Every source region exit classified as `failed` by a parallel branch, repeat body, or
map body MUST have an output schema canonically equal to
`PipelineFailureValueSchema`. Any other schema is `DATA_FAILED_EXIT_SCHEMA` at that
exit's source path. This rule is exact; an `anyOf` containing the failure schema is not
equal and is rejected.

Parallel has 2–32 branches. A threshold is in `1..branchCount`. `all`, `any`, and
`threshold` allow deterministic early decision; `remaining` controls drain or cancel.
Its compiler-derived output is exactly `{classification, branches}`, where classification
is `completed | impossible | failed | cancelled` and branches is a total canonical
branch-key record. Every branch value is exactly completed `{outcome,output}`, failed
`{failure}`, or cancelled, discriminated respectively by `status:'completed'`,
`status:'failed'`, or `status:'cancelled'`; no branch is missing after early
drain/cancel. A source exit classified `failed` produces the failed form and copies its
validated `PipelineFailure` output unchanged; it is not a completed author outcome.

Repeat `maximumIterations` is in `1..100`. When `continueWhen` is true after the final
allowed iteration, the node MUST choose `exhausted`; it MUST NOT raise an invariant
failure. Map `maximumItems` is in `0..10000`; `maximumConcurrency` is in
`1..max(1, maximumItems)`. Map routes are exactly `completed`, `failed`, and `cancelled`.
`collect` records failed item results and MAY still route `completed`; `failFast` selects
`failed` on the first failed item. An item cancelled by fail-fast cleanup is not a map
region cancellation. Only cancellation of the map region selects `cancelled`.
The compiler-derived map output is exactly `{items}`, a canonical item-key-ordered array
of `{itemKey,status,output,errorCode}` with status `succeeded | failed | cancelled`.
`errorCode` is derived from the retained exact failure's `code` for a failed item and is
`null` otherwise; the machine retains the complete failure including `path`.

A signal wait with `payloadSchema: null` accepts no payload and has fixed output schema
`{type:'null'}`. A signal wait with a schema has exactly that output schema and outputs
the validated payload. A duration wait has fixed output schema `{type:'null'}`.

A human gate declares vocabulary and abstract authorization requirements only. It MUST
NOT declare answer arbitration or resolution policy. The host owns authentication,
authorization, separation of duties, conflict arbitration, deadlines, inboxes, and
audit. The kernel receives the host's explicit `answer`, `conflict`, or `deadline`
resolution. Its successful output schema is the exact closed union of
`{kind:'answer',answer,actorRef}`, `{kind:'conflict'}`, and `{kind:'deadline'}`; callers
do not supply another gate output schema.

`HumanGateSourceNode.answers` and `routes.answers` are keyed sets by answer string. Each
set MUST contain unique NFC values, the two key sets MUST be equal, and both normalize
into Unicode code-point order. A duplicate answer, duplicate route, missing route, or
extra route produces exactly `SOURCE_GATE_ANSWER_BIJECTION` at the source human-gate
node path. Input array order has no semantic effect.

## Scope input, terminal results, and child failure

`moduleInput` selects the immutable input of the current module invocation.
`scopeInput` selects the immutable input of the current region frame. Every
structured-node mapping MUST construct the
complete child scope input, which MUST satisfy the normalized child `inputSchema` under
the exact compatibility rules below.

Every `ValueMapping` constructs one closed object from its named fields, so each mapped
activity or child input schema MUST have `type:'object'`. A top-module input may use any
`ValueSchema`; its top region receives that value directly. No implicit scalar wrapper
or object spreading exists.

`nodeOutput` reads only the `output` of a dominated succeeded terminal result.
`nodeFailure` reads only the exact `{code,path}` failure of a dominated failed terminal
result and is valid only on that node's declared failure route. A cancelled result has no
payload selector. Output/failure access outside its status-specific dominated route is a
`DATA_DOMINANCE` compile error.

At runtime, child input is constructed and validated before the child frame is created.
A mismatch MUST become `DATA_SCHEMA_MISMATCH` owned by the structured node: parallel or
consensus classifies the child failure, repeat/map chooses its `failed` route, and call
chooses its `failed` route. It MUST NOT create the child frame, throw, or terminate the
run except through the declared route. Top-region input mismatch remains initialization
failure.

## Dataflow and schema compatibility

The compiler MUST project a selector schema statically through every JSON Pointer. A
missing object property, non-canonical array index, traversal through a scalar, or open
pointer target MUST be a `DATA_POINTER_STATIC` diagnostic. Every mapping target has the
schema declared by its field in the receiving object.

Compatibility is exact canonical schema equality, with one exception: a producer
`{type:'integer'}` is compatible with consumer `{type:'number'}` when its optional bounds
are within the consumer bounds. No object width, union distribution, enum widening,
number-to-integer, or implicit coercion rule exists in v1.

The compiler MUST validate lexical scope, dominance, selector existence, pointer
projection, and compatibility. Parallel locals merge only through the parallel output.
Repeat and map locals escape only through their declared output. A module end output must
be derivable from values that dominate that end.

## Linking, bounds, and diagnostics

Calls MUST resolve within the package. Direct/indirect recursion is invalid. A package
MUST NOT exceed 64 modules, 4,096 source nodes, 16,384 targets, nesting depth 32, or call
depth 32. Overflow-safe static/dynamic expansion MUST prove no more than the package's
`maximumTotalActivities`, which is in `1..1000000`.

For every call, the normalized keyed set of `routes.outcomes[].outcome` MUST equal the
normalized keyed set of the called module region's exits. A missing value, extra value,
or both produces exactly one `LINK_MODULE_OUTCOME_MISMATCH` at the call node's
`/routes/outcomes` path, with fixed LINK-family message
`The call outcome routes do not match the called module outcomes.`

```ts
type PipelineDiagnosticFamily =
  | 'SOURCE'
  | 'MATERIALIZATION'
  | 'LINK'
  | 'DATA'
  | 'BOUND'
  | 'REQUIREMENT'
  | 'LOWERING'
  | 'CANONICAL';
type PipelineDiagnostic = {
  readonly family: PipelineDiagnosticFamily;
  readonly code: string;
  readonly path: JsonPointer;
  readonly message: string;
};
```

Codes MUST be stable uppercase family-prefixed identifiers. Diagnostics MUST sort by
family priority in the order above, then path by Unicode code point, then code. Messages
MUST be fixed templates of at most 512 characters and MUST NOT render input values,
secret references, prompts, or executor data. At most 100 diagnostics are returned; an
overflow returns the first 99 plus `SOURCE_DIAGNOSTIC_LIMIT` at the root.

## Compile-time extension seam

The first alpha MAY use an internal lowering interface for built-in sugar. It MUST
finish before source validation and emit only these exact source shapes. It MUST NOT be
exported, load JavaScript plugins, add source/IR kinds, or participate at runtime.
