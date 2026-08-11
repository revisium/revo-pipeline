# Pipeline Materialization v1

- Status: Draft
- Version: 1.0.0-draft
- Target package: `@revisium/revo-pipeline`

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

## Scope

This specification defines the complete portable profile contribution accepted by the
compiler. It selects agent-slot structure only. It does not define stored profiles,
concrete agents, or executor bindings. This API remains Draft and unavailable from the
package root while conformance is incomplete. Its TypeBox schema MUST use
`additionalProperties: false` at every object.

## Exact envelope

```ts
type AbstractParticipant = {
  readonly key: string;
  readonly bindingKey: string;
};

type SlotSelection =
  | {
      readonly strategy: 'single';
      readonly participant: AbstractParticipant;
    }
  | {
      readonly strategy: 'consensus';
      readonly participants: readonly [AbstractParticipant, ...AbstractParticipant[]];
    };

type AgentSlotMaterialization = {
  readonly sourcePath: JsonPointer;
  readonly slotKey: string;
  readonly selection: SlotSelection;
};

type ProfileMaterialization = {
  readonly schemaVersion: 'pipeline-materialization/v1';
  readonly sourceDigest: Digest;
  readonly slots: readonly AgentSlotMaterialization[];
};
```

This is the complete field set. Materialization MUST NOT select or repeat a consensus
policy, participant bounds, remaining-work policy, or source route. Those fields belong
only to the source agent slot. It MUST NOT contain profile ID/name, role, skill, prompt,
tool, permission, model, provider, runner, runtime, workspace, retry, timeout, secret,
or host policy.

`sourcePath` MUST be the canonical RFC 6901 path to one reachable source `agent` node.
Every reachable agent node MUST appear exactly once, in path order, and no other source
node may appear. The path's `slotKey` MUST equal the materialization `slotKey`.

Participant `key` and `bindingKey` are abstract NFC identifiers. Keys MUST be unique in a
selection. `bindingKey` is the only value later used by core to resolve an exact
`AgentAssembly`; it MUST NOT embed assembly attributes.

## Source-envelope validation

The materialization `sourceDigest` MUST equal the digest of the supplied source package.
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

Explicit source `consensus`, `script`, and `effect` nodes MUST NOT have materialization
entries. The profile cannot add, remove, reorder, or replace explicit-consensus
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
5. five choice cases for `approved`, `rejected`, `inconclusive`,
   `participantFailed`, and `cancelled`, using the source routes.

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

`revo-core` MAY derive this envelope from a versioned stored profile. It then resolves
the emitted abstract binding keys to exact immutable assemblies. `revo-pipeline` MUST
NOT inspect the stored profile or resolved assembly. `revo-run` MUST NOT select a
profile.
