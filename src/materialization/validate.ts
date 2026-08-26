import {
  canonicalizeOwnedValue,
  appendJsonPointer,
  compareUnicodeCodePoints,
  createDiagnosticCollector,
  digestCanonicalBytes,
  isIdentifier,
  PIPELINE_LIMITS,
  type Digest,
  type JsonPointer,
  type PipelineDiagnostic,
} from '../foundation/index.js';
import {
  createEnvelopeValidator,
  type ConsensusAgentStrategy,
  type ReachableAgentSlot,
  type ValidatedPipelineSource,
} from '../source/index.js';
import {
  PipelineSelectionsEnvelopeSchema,
  type AbstractParticipant,
  type InternalAgentSlot,
  type InternalMaterialization,
  type InternalSlotSelection,
  type PipelineSelections,
} from './contracts.js';

export type ValidatedPipelineSelections = {
  readonly materialization: InternalMaterialization;
  readonly materializationDigest: Digest;
  readonly canonicalText: string;
};

export type PipelineSelectionsValidationResult =
  | { readonly ok: true; readonly value: ValidatedPipelineSelections }
  | { readonly ok: false; readonly diagnostics: readonly PipelineDiagnostic[] };

type SelectionEntry = {
  readonly sourceNodeId: string;
  readonly selection:
    | { readonly strategy: 'single'; readonly participant: AbstractParticipant }
    | { readonly strategy: 'consensus'; readonly participants: readonly AbstractParticipant[] };
};

const validateEnvelope = createEnvelopeValidator<PipelineSelections>({
  schema: PipelineSelectionsEnvelopeSchema,
  mapFailure: (_keyword, path) => ({ code: 'MATERIALIZATION_SELECTION_INVALID', path }),
  knownDiscriminators: ['single', 'consensus'],
  objectLimit: (path) =>
    path === '' ? PIPELINE_LIMITS.sourcePackage.nodes : PIPELINE_LIMITS.portableValue.objectKeys,
  allowNonNfcObjectKeys: true,
});

const policySupportsCount = (strategy: ConsensusAgentStrategy, count: number): boolean => {
  if (count < strategy.minimumParticipants || count > strategy.maximumParticipants) {
    return false;
  }
  if (strategy.policy.kind === 'quorum') {
    return strategy.policy.minimumParticipation <= count;
  }
  return (
    strategy.policy.kind !== 'independentThreshold' ||
    (strategy.policy.approveThreshold <= count &&
      strategy.policy.rejectThreshold <= count &&
      strategy.policy.approveThreshold + strategy.policy.rejectThreshold > count)
  );
};

const validateParticipant = (
  participant: AbstractParticipant,
  path: JsonPointer,
  diagnostics: ReturnType<typeof createDiagnosticCollector>,
): AbstractParticipant => {
  if (!isIdentifier(participant.key)) {
    diagnostics.add('MATERIALIZATION_SELECTION_INVALID', `${path}/key`);
  }
  if (!isIdentifier(participant.bindingKey)) {
    diagnostics.add('MATERIALIZATION_SELECTION_INVALID', `${path}/bindingKey`);
  }
  return Object.freeze({ ...participant });
};

const nonEmptyParticipants = <Participant>(
  first: Participant,
  ...rest: readonly Participant[]
): [Participant, ...Participant[]] => [first, ...rest];

const compareParticipants = (left: AbstractParticipant, right: AbstractParticipant): number => {
  const byKey = compareUnicodeCodePoints(left.key, right.key);
  return byKey === 0 ? compareUnicodeCodePoints(left.bindingKey, right.bindingKey) : byKey;
};

const sortedParticipants = (
  participants: readonly AbstractParticipant[],
): readonly AbstractParticipant[] => participants.toSorted(compareParticipants);

const validateSelectionParticipants = (
  entry: SelectionEntry,
  diagnostics: ReturnType<typeof createDiagnosticCollector>,
): void => {
  const { sourceNodeId, selection } = entry;
  const rootPath = `/${sourceNodeId}` as JsonPointer;
  if (selection.strategy === 'single') {
    validateParticipant(selection.participant, `${rootPath}/participant`, diagnostics);
    return;
  }

  const participantKeys = new Set<string>();
  for (const [participantIndex, participant] of sortedParticipants(
    selection.participants,
  ).entries()) {
    validateParticipant(participant, `${rootPath}/participants/${participantIndex}`, diagnostics);
    if (participantKeys.has(participant.key)) {
      diagnostics.add(
        'MATERIALIZATION_PARTICIPANT_DUPLICATE',
        `${rootPath}/participants/${participantIndex}/key`,
      );
    }
    participantKeys.add(participant.key);
  }
};

const normalizeSelection = (entry: SelectionEntry): InternalSlotSelection => {
  const { selection } = entry;
  if (selection.strategy === 'single') {
    return Object.freeze({
      strategy: 'single',
      participant: Object.freeze({ ...selection.participant }),
    });
  }
  const participants = sortedParticipants(selection.participants).map((participant) =>
    Object.freeze({ ...participant }),
  );
  const [first, ...rest] = participants;
  if (first === undefined) {
    throw new TypeError('Expected a schema-validated non-empty participant selection.');
  }
  return Object.freeze({
    strategy: 'consensus',
    participants: Object.freeze(nonEmptyParticipants(first, ...rest)),
  });
};

const validateSelectionAgainstAgent = (
  entry: SelectionEntry,
  agent: ReachableAgentSlot,
  diagnostics: ReturnType<typeof createDiagnosticCollector>,
): void => {
  const { sourceNodeId, selection } = entry;
  const rootPath = `/${sourceNodeId}` as JsonPointer;
  const strategy = agent.strategies.find(({ kind }) => kind === selection.strategy);
  if (strategy === undefined) {
    diagnostics.add('MATERIALIZATION_STRATEGY_UNAVAILABLE', `${rootPath}/strategy`);
    return;
  }
  if (
    selection.strategy === 'consensus' &&
    (strategy.kind !== 'consensus' || !policySupportsCount(strategy, selection.participants.length))
  ) {
    diagnostics.add('MATERIALIZATION_POLICY_COUNT', `${rootPath}/participants`);
  }
};

const validateCoverage = (
  selections: readonly SelectionEntry[],
  agents: readonly ReachableAgentSlot[],
  diagnostics: ReturnType<typeof createDiagnosticCollector>,
): void => {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const selectedIds = new Set<string>();
  for (const entry of selections) {
    const agent = agentsById.get(entry.sourceNodeId);
    const rootPath = `/${entry.sourceNodeId}` as JsonPointer;
    if (agent === undefined) {
      diagnostics.add('MATERIALIZATION_SLOT_EXTRA', rootPath);
      continue;
    }
    selectedIds.add(agent.id);
    validateSelectionAgainstAgent(entry, agent, diagnostics);
  }
  for (const agent of agents) {
    if (!selectedIds.has(agent.id)) {
      diagnostics.add('MATERIALIZATION_SLOT_MISSING', `/${agent.id}`);
    }
  }
};

const materialize = (
  source: ValidatedPipelineSource,
  selections: readonly SelectionEntry[],
  agents: readonly ReachableAgentSlot[],
): InternalMaterialization => {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const slots: InternalAgentSlot[] = selections
    .map((entry) =>
      Object.freeze({
        sourceNodeId: entry.sourceNodeId,
        sourcePath: agentsById.get(entry.sourceNodeId)?.sourcePath ?? '',
        selection: normalizeSelection(entry),
      }),
    )
    .toSorted((left, right) => compareUnicodeCodePoints(left.sourceNodeId, right.sourceNodeId));
  return Object.freeze({
    schemaVersion: 'pipeline-materialization/v1',
    sourceDigest: source.sourceDigest,
    slots: Object.freeze(slots),
  });
};

export const validatePipelineSelections = (
  source: ValidatedPipelineSource,
  input: unknown,
): PipelineSelectionsValidationResult => {
  const envelope = validateEnvelope(input);
  if (!envelope.ok) {
    return envelope;
  }
  const diagnostics = createDiagnosticCollector();
  let hasInvalidSourceNodeId = false;
  const selections = Object.entries(envelope.value)
    .filter(([sourceNodeId]) => {
      if (isIdentifier(sourceNodeId)) {
        return true;
      }
      diagnostics.add('MATERIALIZATION_SELECTION_INVALID', appendJsonPointer('', sourceNodeId));
      hasInvalidSourceNodeId = true;
      return false;
    })
    .map(([sourceNodeId, selection]) => Object.freeze({ sourceNodeId, selection }))
    .toSorted((left, right) => compareUnicodeCodePoints(left.sourceNodeId, right.sourceNodeId));
  if (hasInvalidSourceNodeId) {
    return { ok: false, diagnostics: diagnostics.finalize() };
  }
  validateCoverage(selections, source.reachableAgents, diagnostics);
  for (const entry of selections) {
    validateSelectionParticipants(entry, diagnostics);
  }
  const finalized = diagnostics.finalize();
  if (finalized.length > 0) {
    return { ok: false, diagnostics: finalized };
  }
  const materialization = materialize(source, selections, source.reachableAgents);
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
