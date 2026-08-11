import {
  canonicalizeOwnedValue,
  compareUnicodeCodePoints,
  createDiagnosticCollector,
  digestCanonicalBytes,
  isDigest,
  isIdentifier,
  isJsonPointer,
  type Digest,
  type DiagnosticCollector,
  type JsonPointer,
  type PipelineDiagnostic,
} from '../foundation/index.js';
import {
  createEnvelopeValidator,
  type ConsensusAgentStrategy,
  type EnvelopeValidatorOptions,
  type ReachableAgentSlot,
  type ValidatedPipelineSource,
} from '../source/index.js';
import {
  ProfileMaterializationSchema,
  type AbstractParticipant,
  type AgentSlotMaterialization,
  type ProfileMaterialization,
  type SlotSelection,
} from './contracts.js';

export type ValidatedProfileMaterialization = {
  readonly materialization: ProfileMaterialization;
  readonly materializationDigest: Digest;
  readonly canonicalText: string;
};

export type ProfileMaterializationValidationResult =
  | { readonly ok: true; readonly value: ValidatedProfileMaterialization }
  | { readonly ok: false; readonly diagnostics: readonly PipelineDiagnostic[] };

const materializationFailureMapper: NonNullable<
  EnvelopeValidatorOptions<ProfileMaterialization>['mapFailure']
> = (keyword, path) =>
  (keyword === 'minItems' || keyword === 'maxItems') && path.endsWith('/participants')
    ? { code: 'MATERIALIZATION_POLICY_COUNT', path }
    : null;

const validateEnvelope = createEnvelopeValidator<ProfileMaterialization>({
  schema: ProfileMaterializationSchema,
  mapFailure: materializationFailureMapper,
  knownDiscriminators: ['pipeline-materialization/v1', 'single', 'consensus'],
});

const normalizeParticipant = (
  participant: AbstractParticipant,
  path: JsonPointer,
  diagnostics: DiagnosticCollector,
): AbstractParticipant => {
  if (!isIdentifier(participant.key)) {
    diagnostics.add('CANONICAL_INPUT', `${path}/key`);
  }
  if (!isIdentifier(participant.bindingKey)) {
    diagnostics.add('CANONICAL_INPUT', `${path}/bindingKey`);
  }
  return Object.freeze({ ...participant });
};

const normalizeParticipants = (
  participants: readonly AbstractParticipant[],
  path: JsonPointer,
  diagnostics: DiagnosticCollector,
): readonly [AbstractParticipant, ...AbstractParticipant[]] => {
  const ordered = [...participants].sort((left, right) =>
    compareUnicodeCodePoints(left.key, right.key),
  );
  const seen = new Set<string>();
  const normalized = ordered.map((participant, index) => {
    if (seen.has(participant.key)) {
      diagnostics.add('CANONICAL_INPUT', path);
    }
    seen.add(participant.key);
    return normalizeParticipant(participant, `${path}/${index}`, diagnostics);
  });
  const [first, ...rest] = normalized;
  if (first === undefined) {
    throw new TypeError('Expected a schema-validated non-empty participant array.');
  }
  return Object.freeze([first, ...rest]);
};

const normalizeSelection = (
  selection: SlotSelection,
  path: JsonPointer,
  diagnostics: DiagnosticCollector,
): SlotSelection => {
  if (selection.strategy === 'single') {
    const participant = normalizeParticipant(
      selection.participant,
      `${path}/participant`,
      diagnostics,
    );
    return Object.freeze({ strategy: 'single', participant });
  }
  return Object.freeze({
    strategy: 'consensus',
    participants: normalizeParticipants(
      selection.participants,
      `${path}/participants`,
      diagnostics,
    ),
  });
};

const normalizeSlots = (
  slots: readonly AgentSlotMaterialization[],
  diagnostics: DiagnosticCollector,
): readonly AgentSlotMaterialization[] => {
  const ordered = [...slots].sort((left, right) =>
    compareUnicodeCodePoints(left.sourcePath, right.sourcePath),
  );
  const seen = new Set<string>();
  return Object.freeze(
    ordered.map((slot, index) => {
      const path = `/slots/${index}` as JsonPointer;
      if (seen.has(slot.sourcePath)) {
        diagnostics.add('CANONICAL_INPUT', `${path}/sourcePath`);
      }
      seen.add(slot.sourcePath);
      if (!isJsonPointer(slot.sourcePath)) {
        diagnostics.add('CANONICAL_INPUT', `${path}/sourcePath`);
      }
      if (!isIdentifier(slot.slotKey)) {
        diagnostics.add('CANONICAL_INPUT', `${path}/slotKey`);
      }
      return Object.freeze({
        ...slot,
        selection: normalizeSelection(slot.selection, `${path}/selection`, diagnostics),
      });
    }),
  );
};

const policySupportsCount = (strategy: ConsensusAgentStrategy, count: number): boolean => {
  if (count < strategy.minimumParticipants || count > strategy.maximumParticipants) {
    return false;
  }
  if (strategy.policy.kind === 'quorum') {
    return strategy.policy.minimumParticipation <= count;
  }
  if (strategy.policy.kind === 'independentThreshold') {
    return (
      strategy.policy.approveThreshold <= count &&
      strategy.policy.rejectThreshold <= count &&
      strategy.policy.approveThreshold + strategy.policy.rejectThreshold > count
    );
  }
  return true;
};

const validateSlot = (
  slot: AgentSlotMaterialization,
  index: number,
  agent: ReachableAgentSlot,
  diagnostics: DiagnosticCollector,
): void => {
  const path = `/slots/${index}` as JsonPointer;
  if (slot.slotKey !== agent.slotKey) {
    diagnostics.add('CANONICAL_INPUT', `${path}/slotKey`);
  }
  const strategy = agent.strategies.find(({ kind }) => kind === slot.selection.strategy);
  if (strategy === undefined) {
    diagnostics.add('CANONICAL_INPUT', `${path}/selection/strategy`);
    return;
  }
  if (
    slot.selection.strategy === 'consensus' &&
    (strategy.kind !== 'consensus' ||
      !policySupportsCount(strategy, slot.selection.participants.length))
  ) {
    diagnostics.add('MATERIALIZATION_POLICY_COUNT', `${path}/selection/participants`);
  }
};

const validateCoverage = (
  slots: readonly AgentSlotMaterialization[],
  agents: readonly ReachableAgentSlot[],
  diagnostics: DiagnosticCollector,
): void => {
  const agentsByPath = new Map(agents.map((agent) => [agent.sourcePath, agent]));
  for (const [index, slot] of slots.entries()) {
    const agent = agentsByPath.get(slot.sourcePath);
    if (agent === undefined) {
      diagnostics.add('CANONICAL_INPUT', `/slots/${index}/sourcePath`);
    } else {
      validateSlot(slot, index, agent, diagnostics);
    }
  }
  if (
    slots.length !== agents.length ||
    agents.some(({ sourcePath }) => !slots.some((slot) => slot.sourcePath === sourcePath))
  ) {
    diagnostics.add('CANONICAL_INPUT', '/slots');
  }
};

export const validateProfileMaterialization = (
  source: ValidatedPipelineSource,
  input: unknown,
): ProfileMaterializationValidationResult => {
  const envelope = validateEnvelope(input);
  if (!envelope.ok) {
    return envelope;
  }
  const diagnostics = createDiagnosticCollector();
  if (
    !isDigest(envelope.value.sourceDigest) ||
    envelope.value.sourceDigest !== source.sourceDigest
  ) {
    diagnostics.add('CANONICAL_INPUT', '/sourceDigest');
  }
  const materialization = Object.freeze({
    ...envelope.value,
    slots: normalizeSlots(envelope.value.slots, diagnostics),
  });
  validateCoverage(materialization.slots, source.reachableAgents, diagnostics);
  const finalized = diagnostics.finalize();
  if (finalized.length > 0) {
    return { ok: false, diagnostics: finalized };
  }
  const canonical = canonicalizeOwnedValue(materialization);
  return {
    ok: true,
    value: Object.freeze({
      materialization,
      materializationDigest: digestCanonicalBytes('pipeline-materialization/v1', canonical.bytes),
      canonicalText: canonical.text,
    }),
  };
};
