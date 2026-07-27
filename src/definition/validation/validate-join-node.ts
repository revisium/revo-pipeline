import type { DefinitionValidationContext } from './definition-validation-context.js';

type RecordValue = Record<string, unknown>;

const JOIN_OUTCOMES = ['completed', 'insufficient', 'rejected'] as const;

export const validateJoinNode = (
  node: RecordValue,
  path: string,
  context: DefinitionValidationContext,
): void => {
  context.unknownFields(node, ['fork', 'key', 'kind', 'outcomes', 'policy'], path);
  context.requireKey(node.fork, `${path}/fork`);
  context.validateExactRoutes(node.outcomes, JOIN_OUTCOMES, `${path}/outcomes`);
  if (
    !context.isRecord(node.policy) ||
    !['all', 'any', 'threshold'].includes(String(node.policy.kind))
  ) {
    context.addFault('DEF_TYPE', `${path}/policy`, 'Invalid join policy.');
    return;
  }
  if (node.policy.kind === 'all') {
    context.unknownFields(node.policy, ['kind'], `${path}/policy`);
  } else if (node.policy.kind === 'any') {
    context.unknownFields(node.policy, ['kind', 'remaining'], `${path}/policy`);
    if (node.policy.remaining !== 'unconstrained') {
      context.addFault('DEF_TYPE', `${path}/policy/remaining`, 'Invalid remaining policy.');
    }
  } else {
    context.unknownFields(node.policy, ['count', 'kind'], `${path}/policy`);
    if (!Number.isSafeInteger(node.policy.count) || Number(node.policy.count) < 1) {
      context.addFault('DEF_JOIN_THRESHOLD', `${path}/policy/count`, 'Invalid threshold.');
    }
  }
};
