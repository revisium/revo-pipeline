import type { ProfileMaterialization } from '../../src/materialization/index.js';
import {
  validatePipelineSource,
  type AgentSourceNode,
  type PipelineSourcePackage,
} from '../../src/source/index.js';
import { sourceNodeBuilders } from './source-builders.js';

export const materializationFor = (
  source: PipelineSourcePackage,
  selection?: ProfileMaterialization['slots'][number]['selection'],
): ProfileMaterialization => {
  const validated = validatePipelineSource(source);
  if (!validated.ok) {
    throw new Error(`Expected valid compiler source: ${JSON.stringify(validated.diagnostics)}`);
  }
  const slots =
    selection === undefined
      ? []
      : [
          {
            sourcePath: validated.value.reachableAgents[0]?.sourcePath ?? '',
            slotKey: validated.value.reachableAgents[0]?.slotKey ?? '',
            selection,
          },
        ];
  return {
    schemaVersion: 'pipeline-materialization/v1',
    sourceDigest: validated.value.sourceDigest,
    slots,
  };
};

export const singleSelection = () => ({
  strategy: 'single' as const,
  participant: { key: 'reviewer', bindingKey: 'reviewer-binding' },
});

export const consensusSelection = () => ({
  strategy: 'consensus' as const,
  participants: [
    { key: 'alice', bindingKey: 'alice-binding' },
    { key: 'bob', bindingKey: 'bob-binding' },
  ] as const,
});

export const consensusAgentNode = (): AgentSourceNode => {
  const base = sourceNodeBuilders.agent();
  return {
    ...base,
    strategies: [
      ...base.strategies,
      {
        kind: 'consensus',
        minimumParticipants: 2,
        maximumParticipants: 2,
        policy: { kind: 'unanimous' },
        remaining: 'drain',
        routes: {
          approved: 'done',
          rejected: 'done',
          inconclusive: 'done',
          participantFailed: 'done',
          cancelled: 'done',
        },
      },
    ],
  };
};
