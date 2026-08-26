# Pipeline Materialization v1

- Status: Draft
- Version: 1.0.0-draft
- Target package: `@revisium/revo-pipeline`

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

## Scope

This specification defines the complete portable selection contribution accepted by the
compiler. It selects agent-slot structure only. It does not define stored profiles,
concrete agents, or executor bindings. The contract remains Draft; its under-development
API is available from npm `alpha` prereleases and local or CI-built tarballs without a
compatibility guarantee. Its TypeBox schema MUST use
`additionalProperties: false` at every object.

## Exact envelope

```ts
type AbstractParticipant = {
  readonly key: string;
  readonly bindingKey: string;
};

type PipelineSelection =
  | { readonly strategy: 'single'; readonly participant: AbstractParticipant }
  | {
      readonly strategy: 'consensus';
      readonly participants: readonly [AbstractParticipant, ...AbstractParticipant[]];
    };

type PipelineSelections = Readonly<Record<SourceNodeId, PipelineSelection>>;
```

This is the complete field set. Materialization MUST NOT select or repeat a consensus
policy, participant bounds, remaining-work policy, or source route. Those fields belong
only to the source agent slot. It MUST NOT contain profile ID/name, role, skill, prompt,
tool, permission, model, provider, runner, runtime, workspace, retry, timeout, secret,
or host policy.

Every reachable source `agent` node MUST appear exactly once under its globally unique
`SourceNodeId`; no other source node may appear. A selection is addressed by that ID,
not by an array index, alias, or source path. Object insertion order is nonsemantic.

Participant `key` and `bindingKey` are abstract NFC identifiers. Keys MUST be unique in a
selection. `bindingKey` is the only value later used by `revo-run` composition to resolve
an exact agent definition; it MUST NOT embed definition or executor attributes.

## Source-envelope validation

`compilePipeline` validates the caller selections against its supplied source, owns,
normalizes, and hashes the internal materialization. There is no public materialization
document or materialization digest helper.

The selected strategy MUST be present in the source slot's exact `strategies` set.

`single` has exactly one participant by shape. `consensus` has 1–32 participants and its
count MUST be in the source strategy's inclusive minimum/maximum range. The consensus
policy and `remaining` behavior MUST be copied from source into the emitted Program IR;
the materialization has no ability to alter them. The compiler MUST NOT infer a required
participant count from the source because a slot intentionally has no source participant
list.

The compiler MUST revalidate the source policy for the exact participant count. Quorum
minimum participation MUST be reachable. Each independent threshold MUST be reachable.
`approveThreshold + rejectThreshold` MUST exceed the exact participant count. A failure
is `MATERIALIZATION_POLICY_COUNT`, not a tie-break opportunity.

Explicit source `consensus` and `script` nodes MUST NOT have materialization
entries. Caller selections cannot add, remove, reorder, or replace explicit-consensus
participants.

## Exact lowering

A `single` selection emits exactly one agent `ProgramRequirement` and one `activity` IR
node. Both use the selected participant's `bindingKey`. Provenance includes the source
path and materialization path.

A `consensus` selection emits exactly:

1. one `parallel` IR node in vote mode;
2. one named branch per participant, in participant-key order; its required input mapping
   is the lowered source agent-slot input, its region input schema is the slot input
   schema, and its binding key is the selected participant's exact binding key;
3. exactly one agent `activity` and three `end` nodes in each branch; the activity
   consumes branch `scopeInput` by identity, references the requirement for that branch
   binding, uses the same input schema, has output schema equal to the closed vote schema
   `approve | reject | abstain`, and routes succeeded/failed/cancelled to the respective
   vote/failed/cancelled end;
4. one `choice` IR node after the parallel;
5. five choice cases in exact Unicode order: `approved`, `cancelled`, `inconclusive`,
   `participantFailed`, and `rejected`, using the same-named source routes and no
   `otherwise` target.

The vote-parallel policy classifies but does not route. The synthesized choice alone
routes the five classifications. An explicit source consensus emits the identical
fragment shape: each fixed participant supplies its own branch key, binding key, input
mapping, and input schema. Slot consensus ignores the slot's single-strategy
`outputSchema`; both forms use the fixed vote output schema for participant activities.

The compiler MUST statically validate each branch mapping in its enclosing scope, its
constructed object against the branch region input schema, the participant identity
mapping against the same schema, and the activity requirement's exact binding/input/vote
schemas. A missing, incompatible, foreign-scope, or non-identity mapping is a compile
diagnostic and produces no Program.

Participants lower in Unicode key order. Each branch region and its three exits use the
exact schemas, IDs, end mappings, outcome conversion, and provenance ordinals from
Program v1. Explicit participants have null materialization provenance; slot participants
use their own selected-participant path for the region, activity, and all three ends.
Materialization provenance is canonical and independent of caller order. For source node
ID `id`, the aggregate parallel and choice use `/{id}`, a single activity and requirement
use `/{id}/participant`, and consensus participant region/activity/ends plus requirement
use `/{id}/participants/{i}`. No generated element may use a sibling participant path.
Selection diagnostics use these same record paths.

A successful participant must explicitly output one vote. Activity failure is
`participantFailed`. Participant cancellation before consensus-region cancellation is
also `participantFailed`. The `cancelled` classification means cancellation of the
whole consensus region; it is never inferred from an isolated participant cancellation.

## Determinism and ownership

Slots and participants MUST canonicalize by Unicode code-point key order. Input array or
object insertion order MUST NOT affect output. Synthesized IDs follow Program v1's full
SHA-256 rule and MUST preserve source/materialization provenance.

`materializationDigest` covers this complete envelope, including `sourceDigest`.
`sourceDigest` is unchanged across profiles. A changed strategy, participant key, or
binding key changes `materializationDigest`; changed emitted requirements, topology, or
provenance changes `programDigest`.

`revo-core` MAY pass a versioned stored source/profile to `revo-run`, which derives this
envelope and resolves emitted abstract binding keys through its composition. `revo-pipeline`
MUST NOT inspect stored profiles or resolved assemblies. The host runtime MUST NOT select
a profile.
