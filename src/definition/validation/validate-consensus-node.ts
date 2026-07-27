import { PIPELINE_LIMITS } from '../../policy/index.js';
import type { DefinitionValidationContext } from './definition-validation-context.js';

type RecordValue = Record<string, unknown>;

const CONSENSUS_OUTCOMES = ['approved', 'insufficient', 'rejected', 'tied'] as const;

export const validateConsensusNode = (
  node: RecordValue,
  path: string,
  context: DefinitionValidationContext,
): number => {
  context.unknownFields(node, ['candidates', 'key', 'kind', 'outcomes', 'policy'], path);
  context.validateExactRoutes(node.outcomes, CONSENSUS_OUTCOMES, `${path}/outcomes`);
  if (
    !context.requireArray(
      node.candidates,
      `${path}/candidates`,
      PIPELINE_LIMITS.definition.candidatesPerNode,
    )
  ) {
    return 0;
  }
  if (node.candidates.length === 0) {
    context.addFault(
      'DEF_CONSENSUS_CANDIDATE',
      `${path}/candidates`,
      'Candidates must be non-empty.',
    );
  }
  const names = new Set<string>();
  node.candidates.forEach((candidate, index) => {
    if (context.requireName(candidate, `${path}/candidates/${index}`)) {
      if (names.has(candidate)) {
        context.addFault(
          'DEF_CONSENSUS_CANDIDATE',
          `${path}/candidates/${index}`,
          'Duplicate candidate.',
        );
      }
      names.add(candidate);
    }
  });
  if (
    !context.isRecord(node.policy) ||
    !['quorum', 'threshold', 'unanimous'].includes(String(node.policy.kind))
  ) {
    context.addFault('DEF_TYPE', `${path}/policy`, 'Invalid consensus policy.');
    return node.candidates.length;
  }
  const count = node.candidates.length;
  if (node.policy.kind === 'unanimous') {
    context.unknownFields(node.policy, ['kind'], `${path}/policy`);
  } else if (node.policy.kind === 'quorum') {
    context.unknownFields(node.policy, ['kind', 'quorum'], `${path}/policy`);
    if (
      !Number.isSafeInteger(node.policy.quorum) ||
      Number(node.policy.quorum) < 1 ||
      Number(node.policy.quorum) > count
    ) {
      context.addFault('DEF_CONSENSUS_BOUND', `${path}/policy/quorum`, 'Invalid quorum.');
    }
  } else {
    context.unknownFields(node.policy, ['approve', 'kind', 'reject'], `${path}/policy`);
    const approve = Number(node.policy.approve);
    const reject = Number(node.policy.reject);
    if (
      !Number.isSafeInteger(node.policy.approve) ||
      !Number.isSafeInteger(node.policy.reject) ||
      approve < 1 ||
      reject < 1 ||
      approve > count ||
      reject > count ||
      approve + reject <= count
    ) {
      context.addFault('DEF_CONSENSUS_BOUND', `${path}/policy`, 'Invalid threshold bounds.');
    }
  }
  return count;
};
