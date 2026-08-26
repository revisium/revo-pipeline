import type { PipelineSelections } from '../../src/materialization/index.js';
import {
  validatePipelineSource,
  type AgentSourceNode,
  type PipelineSourcePackage,
} from '../../src/source/index.js';
import { sourceNodeBuilders } from './source-builders.js';

export const materializationFor = (
  source: PipelineSourcePackage,
  selection?:
    | {
        readonly strategy: 'single';
        readonly participant: { readonly key: string; readonly bindingKey: string };
      }
    | {
        readonly strategy: 'consensus';
        readonly participants: readonly [
          { readonly key: string; readonly bindingKey: string },
          ...{ readonly key: string; readonly bindingKey: string }[],
        ];
      },
): PipelineSelections => {
  const validated = validatePipelineSource(source);
  if (!validated.ok) {
    throw new Error(`Expected valid compiler source: ${JSON.stringify(validated.diagnostics)}`);
  }
  const sourceNodeId = validated.value.reachableAgents[0]?.id;
  if (selection === undefined || sourceNodeId === undefined) {
    return {};
  }
  return { [sourceNodeId]: selection };
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
