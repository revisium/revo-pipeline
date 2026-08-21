# Pipeline Conformance v1

- Status: Draft
- Version: 1.0.0-draft
- Target package: `@revisium/revo-pipeline`

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

## Scope and lifecycle

This specification defines evidence and the exact under-development public manifest.
The contracts remain Draft and no compatibility behavior is required.

## Exact package manifest

The root `@revisium/revo-pipeline` runtime manifest MUST contain exactly:

```text
ValueSchemaSchema
PipelineSourcePackageSchema
ProfileMaterializationSchema
PipelineProgramSchema
ProgramRequirementsSchema
ProgramProvenanceSchema
PipelineCompileResultSchema
ProgramDigestInputSchema
definePipelineSource
defineProfileMaterialization
compilePipeline
computeSourceDigest
computeMaterializationDigest
computeProgramDigest
```

The root type manifest MUST contain exactly:

```text
JsonScalar JsonValue JsonPointer ValueSchema ValueSelector ValueMapping ChoiceDomain
PipelineFailure RepeatCondition PipelineSourcePackage PipelineSourceModule SourceRegion
SourceRegionExit ActivityRoutes ConsensusRoutes SingleAgentStrategy
ConsensusAgentStrategy AgentSlotStrategy ConsensusPolicy AgentSourceNode ScriptSourceNode
EffectSourceNode ChoiceSourceNode ParallelBranchClassification RegionExitClassification
ParallelSourceBranch ParallelPolicy ParallelRoutes ParallelSourceNode RepeatSourceNode
MapSourceNode WaitSourceNode HumanGateSourceNode ExplicitConsensusParticipant
ConsensusSourceNode CallSourceNode EndSourceNode SourceNode PipelineDiagnosticFamily
PipelineDiagnostic AbstractParticipant SlotSelection AgentSlotMaterialization
ProfileMaterialization Digest ProgramNodeId PipelineCompileResult PipelineProgram
ProgramModule ProgramRegion ProgramRegionExit ProgramValueSelector ProgramValueMapping
ProgramRepeatCondition ProgramActivityNode ProgramChoiceNode ProgramCallNode
GenericParallelBranchResult GenericParallelOutput VoteParallelBranchResult
VoteParallelOutput ProgramParallelBranch ProgramVoteBranch ProgramParallelNode
ProgramRepeatNode ProgramMapNode ProgramWaitNode ProgramHumanGateNode ProgramEndNode
ProgramNode AgentProgramRequirement ScriptProgramRequirement EffectProgramRequirement
ProgramRequirement ProgramRequirements LoweringRole NodeProvenance
RequirementProvenance ProgramProvenance ProgramDigestInput
```

The `@revisium/revo-pipeline/revo-run` runtime manifest MUST contain exactly
`compileToExecutionPlan`. Its type manifest contains only the ADR 0013 pipeline-owned
bridge result, diagnostic, plan, node, binding, policy, and host-input types. The root
and `./kernel` runtime and type manifests remain unchanged.

The helper and digest signatures MUST be exactly:

```ts
declare function definePipelineSource<const T extends PipelineSourcePackage>(value: T): T;
declare function defineProfileMaterialization<const T extends ProfileMaterialization>(value: T): T;
declare function computeSourceDigest(source: PipelineSourcePackage): Digest;
declare function computeMaterializationDigest(value: ProfileMaterialization): Digest;
type ProgramDigestInput = {
  readonly program: PipelineProgram;
  readonly requirements: ProgramRequirements;
  readonly provenance: ProgramProvenance;
};
declare function computeProgramDigest(value: ProgramDigestInput): Digest;
```

Identity helpers MUST return their argument without validation, cloning, freezing,
registration, or I/O. Digest functions validate and either return a digest or throw a
`TypeError` only for nonconforming author-side input; compile and kernel functions use
their structured diagnostic/transition contracts.

The `@revisium/revo-pipeline/kernel` runtime manifest MUST contain exactly:

```text
PipelineProgramSchema
KernelProgramSchema
PipelineStateSchema
PipelineEventSchema
PipelineCommandSchema
InitialPipelineTransitionSchema
PipelineTransitionSchema
createInitialPipelineState
advancePipeline
```

The `./kernel` type manifest MUST contain exactly:

```text
JsonScalar JsonValue JsonPointer ValueSchema PipelineFailure ChoiceDomain ConsensusPolicy
ParallelBranchClassification RegionExitClassification ParallelPolicy Digest ProgramNodeId
PipelineProgram ProgramModule ProgramRegion ProgramRegionExit ProgramValueSelector
ProgramValueMapping ProgramRepeatCondition ProgramActivityNode ProgramChoiceNode
ProgramCallNode GenericParallelBranchResult GenericParallelOutput
VoteParallelBranchResult VoteParallelOutput ProgramParallelBranch ProgramVoteBranch
ProgramParallelNode ProgramRepeatNode ProgramMapNode ProgramWaitNode
ProgramHumanGateNode ProgramEndNode ProgramNode KernelProgram FrameKeyPayload CommandRef
CommandKey NodeTerminalResult RegionTerminalResult MachineFrameBase RegionMachineFrame CallMachineFrame
RegionExecutionState RootRegionMachineFrame CallRegionMachineFrame
ParallelBranchMachineFrame RepeatBodyMachineFrame MapItemMachineFrame
ParallelMachineFrameBase GenericParallelMachineFrame VoteParallelMachineFrame
ParallelMachineFrame RepeatMachineFrame MapItemResult MapMachineFrame MachineFrame
PendingOperation ResolvedOperation RunCancellation RegionCancellation PipelineState
PipelineEvent PipelineCommand InitialPipelineTransition PipelineTransition MachineFaultFamily
MachineFault
```

`package.json` MUST expose only `.`, `./kernel`, and the ADR 0013 `./revo-run` bridge.
No layer barrel, internal lowering
seam, validator helper, comparator, graph algorithm, canonicalizer wrapper, policy model,
XState machine, or runtime plugin API is public.

While these contracts are Draft, the package MUST use version `0.2.0-alpha.1` and
`publishConfig` exactly `{ "access": "public", "tag": "alpha" }`. It MUST NOT be
marked private or block publication through a lifecycle hook. An npm `alpha` prerelease
remains unstable, carries no compatibility guarantee, and makes no `revo-core` or
`revo-run` readiness claim. Its `files` list MUST be exactly `dist`, `README.md`, and
`LICENSE`; packed files MUST be only those three root files plus `dist/**/*.js` and
`dist/**/*.d.ts`. JavaScript, declarations, and package metadata MUST point only at the
three curated ESM entrypoints. Default, CommonJS, wildcard, and deep subpath exports are
forbidden.

## Exact dependency contract

Production dependencies MUST be exactly `typebox@1.3.10` and
`canonicalize@4.0.0`. SHA-256 MUST use built-in `node:crypto`. `fast-check` MAY be an
exact-pinned development dependency. Ajv and XState MUST NOT be production dependencies.
No DBOS, Prisma, queue, NestJS, GraphQL, MCP, CLI, model/provider SDK, persistence,
timer, or authorization dependency is allowed. The ADR 0013 bridge has no host/runtime
dependency; root and kernel production dependency inventories remain unchanged.

## Schema and compiler suites

Every TypeBox schema MUST have runtime/static agreement fixtures. Tests MUST cover every
field, required/optional position, unknown field/version/kind, closed source/IR/event/
command union, recursive region, schema-dialect form, identifier/value limit, and
diagnostic family.

Compiler tests MUST cover all 12 source and nine IR kinds, explicit region exits,
author-exit classifications, target resolution, linked calls, missing calls, direct and
indirect recursion, reachability/dead ends, deterministic diagnostic ordering, and every
static/dynamic bound with overflow.

Choice tests MUST cover type-sensitive disjoint equals/oneOf domains and explicit
otherwise. Repeat tests MUST cover equals/oneOf/exists/all/any/not and choose exhausted
at the bound. Dataflow tests MUST cover scope, dominance, exact schema equality,
integer-to-number compatibility as the sole widening, static pointer projection, and
every forbidden compatibility/pointer case. They MUST cover `moduleInput` versus
`scopeInput`, status-specific `nodeOutput`/`nodeFailure`, normalized empty region input
schemas, structured child input construction, and deterministic owning-node failure on
runtime child-input mismatch.

Human-gate source fixtures MUST permute both answer arrays and prove Unicode-keyed-set
normalization. Duplicate vocabulary, duplicate route, missing route, and extra route
MUST each produce only `SOURCE_GATE_ANSWER_BIJECTION` at the gate source path. An
admitted Program with the same malformed cases MUST be `PROGRAM_INVALID`; a valid
Program receiving an undeclared runtime answer MUST remain `EVENT_GATE_ANSWER`.

Materialization tests MUST prove complete/unique source-path coverage, source-digest
pinning, strategy membership, single cardinality, every consensus count in the source
minimum/maximum range including one, rejection outside it, source-owned routes/policy,
exact-count quorum/threshold reachability, independent-threshold mutual exclusion, and
absence of policy/model/runtime data in materialization. Slot sources MUST have no fixed
participant-list cardinality; explicit consensus MUST validate its fixed list.

Requirement tests MUST prove every activity has one requirement, every requirement is
used, identical declarations deduplicate, conflicting same-key declarations fail, and
requirements contain no resolved assembly or secret/provider data.

Golden lowering fixtures MUST show one activity per single agent/script/effect; one
vote-parallel activity branch per consensus participant; one post-parallel routing
choice; fixed internal branch classifications; exact author-outcome mappings; exact
provenance; and no forbidden IR kind. Slot and explicit consensus fixtures MUST pin each
required `ProgramVoteBranch.input`, branch/input-schema equality, compiler-emitted
`scopeInput` identity activity mapping, branch-specific binding/requirement, and fixed
vote output schema. Full Program golden digests MUST be rebaselined for the required
branch field. Synthesized ID collisions MUST fail.

The same consensus goldens MUST permute participant input order and still lower by
Unicode participant key. For participant `i` they MUST pin the participant-region and
activity IDs at ordinal `i`, vote/failed/cancelled end IDs at ordinals `3*i`, `3*i+1`,
and `3*i+2`, parallel/choice ordinal `0`, canonical node-ID storage order, all five
participant-local provenance records plus the parallel/choice records, explicit null
materialization paths, and slot participant-specific materialization paths. They MUST
pin the exact participant region input schema, fixed vote/failure/empty exit schemas,
`anyOf` output, activity routes, three end mappings, exit-to-branch-result conversion,
and full compiler-bundle `programDigest`. Any fixture from the pre-A3 lowering MUST fail
`PROGRAM_INVALID`, not silently rebaseline at runtime.

Generic-parallel goldens MUST pin the generated-choice order
`cancelled, completed, failed, impossible`; consensus goldens MUST pin
`approved, cancelled, inconclusive, participantFailed, rejected`. Keys and equality
values are identical, `otherwise` is null, generated choices are not source-target
entries, and slot aggregate/single/participant provenance uses the exact Materialization
v1 paths. Linking fixtures MUST prove missing/extra/both call outcomes produce one fixed
`LINK_MODULE_OUTCOME_MISMATCH` at `/routes/outcomes`.

Failed-classification compiler fixtures MUST accept only exact
`PipelineFailureValueSchema` and emit `DATA_FAILED_EXIT_SCHEMA` at the source exit path
for every other schema, including a wider object and `anyOf` wrapper.

## Machine suites

Tests MUST cover exact state/event/command/transition schemas, initial command handling,
every exact frame-key payload and golden, full command/event digest vectors,
within-state command-reference uniqueness, host run namespacing, priority/ref/key
ordering, event causation, identical replay, conflicting replay, foreign/mismatched
events, program-digest rejection, and terminal immutability. Kernel tests MUST prove it
does not recompute the compiler-bundle digest; public digest tests MUST prove complete
validation of `{program,requirements,provenance}`.

Invalid-Program fixtures MUST pin the pre-root `initialization` payload, its null-candidate
frame-key golden, the resulting fail-command golden, and the lexical-candidate case. The
pre-root key MUST never appear in `PipelineState.frames`. Invalid-input fixtures for a
valid Program MUST instead use its actual root-region key and admitted `programDigest`.

Invalid initial input MUST produce failed state plus `INIT_INPUT_SCHEMA`. Runtime missing
pointer and top-level data failure MUST be value-redacted. A child-input schema mismatch
MUST create no child frame. Call/repeat/map store the owning node's
`DATA_SCHEMA_MISMATCH`; parallel stores the exact branch failure before classification.
An unknown executor terminal outcome MUST reject with `EVENT_EXECUTOR_OUTCOME`; custom
domain data must route only through successful output plus choice. A pre-A3 Program
fixture whose vote branch omits `input` or exact participant-region lowering MUST fail
exact Program validation with `PROGRAM_INVALID`; no default mapping may be supplied.

Activity failure fixtures MUST prove `activityFailed(errorCode)` first stores exactly
`{code:errorCode,path:''}` and only then follows the failed route, where `nodeFailure`
can read it. Failed-exit runtime fixtures MUST validate the closed object and semantic
JSON Pointer; malformed code/path/unknown fields become
`DATA_SCHEMA_MISMATCH` with path `''`. Valid failures MUST retain the same code/path
through generic branch, vote, repeat, call, map, and final failure. Simultaneous failures
select the lowest canonical branch/item/node key; failures from separate events retain
the first selected result.

Parallel tests MUST exhaust every qualified/non-qualifying/failed/cancelled/pending
partition for all/any/threshold, early success/impossibility, author classifications,
drain, cancel, acknowledgement, nested structure, and cancellation selected-result
stability. Every early-decision case MUST prove its final generic branch record is total
with `completed | failed | cancelled` entries and no placeholder or missing key.

Consensus tests MUST cover unanimous early rejection/approval, quorum participation and
ties, one-participant materialized consensus, independent thresholds/impossibility,
abstentions, explicit invalid votes, participant failure, isolated participant
cancellation as `participantFailed`, and whole-region cancellation as `cancelled`.
Tests MUST cover missing-pointer and schema-invalid vote-branch input before frame
creation: failed branch result first, no branch frame/command, live-only
`branchRegionKeys`, then deterministic policy classification. Both drain and cancel
fixtures MUST prove selected-result stability and a final total vote record. Tests MUST
prove the parallel only classifies and the one following choice routes. Every final vote
record MUST contain exactly one `vote | failed | cancelled` result for every participant
before classification exits.

Map tests MUST cover empty input, canonical/duplicate keys, item bound, local concurrency
frontier, deterministic item order, collect-with-failures completion, fail-fast
drain/cancel, item cleanup cancellation, and whole-map cancellation. Machine-state
fixtures MUST retain the
full `MapItemResult.failure`; author output MUST derive only `errorCode` from its code,
and fail-fast MUST propagate the full selected failure including path.

Wait tests MUST cover duration null output, signal without payload, signal with
schema-valid payload, bad payload DATA failure, wait cancellation, and serialized-state
recovery. Gate tests MUST cover answer/conflict/deadline union, undeclared answer,
separate gate cancellation, and the absence of kernel auth/arbitration decisions.

Cancellation tests MUST prove nonterminal run cancellation, concurrent per-owner sibling
region cancellation sets, complete target sets, atomic acknowledgement removal from all
containing sets, success/failure/cancel acknowledgements, prohibition on new region sets
after run cancellation selection, no terminal command while any set remains,
same-state/no-command duplicate and late acknowledgements, and no detached work at
terminal.

Frame lifecycle tests MUST prove immutable `scopeInput`, full-ID `nodeResults`, the one
exact succeeded/failed/cancelled envelope, status-specific selector visibility, atomic
child-result copy-up before recursive pruning, identical/conflicting replay while a
receipt is live, and preservation of post-prune replay and audit in the run-owned event
log. Cross-package evidence MUST prove that post-prune identical delivery does not invoke
the kernel again and conflicting delivery is rejected.

Bounded-result tests MUST prove reverse insertion of 4,096 full node IDs produces a
frozen canonically sorted record with exactly 8,390,656 ordinary assignments and at most
`4,096 * 12` key comparisons. They MUST prove duplicate insertion performs no
replacement or mutation, a maximum record hydrates and survives JSON round trip, nested
portable objects remain capped at 64 keys, and `maximumTotalActivities = 1,000,000`
causes no eager allocation. Secondary performance evidence on the reference verification
host MUST warm the path and measure five full insertion runs; median insertion MUST be
at most 5 seconds, hydration at most 500 milliseconds, and final-state serialization at
most 50 milliseconds. See ADR 0008.

## Purity, side-channel, and package evidence

Tests MUST prove deterministic replay, no argument mutation/caller freeze, JSON round
trip, no I/O/environment/clock/randomness/hidden state, and value-redacted bounded
diagnostics. Secret values, prompts, provider payloads, rejected data, and local paths
MUST be absent from compile faults, machine faults, hashes, provenance, state, and
commands.

Property tests SHOULD use exact-pinned `fast-check` with reported seeds. An independent
finite reference model MUST verify parallel and vote completion without importing
production policy helpers.

The packed ESM package MUST pass formatter, types, lint, coverage, dependency-cruiser,
build, publint, ATTW ESM profile, exact export-manifest tests, and runtime dependency
inventory. One installed-tarball smoke MUST type-check and execute the tracked README
quick-start, inspect both entrypoints, and reject default, CommonJS, deep, and unknown
subpath imports without resolving the repository checkout. Hostile input, admission,
replay, mutation, and immutability semantics belong to focused unit suites at their
owning boundaries.
