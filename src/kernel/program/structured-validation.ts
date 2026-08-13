import { isPipelineFailureSchema } from '../../foundation/index.js';
import type { ProgramNode, ProgramParallelNode, ProgramRegion } from '../../program/index.js';
import { isStrictlySorted, sameOrderedKeys } from './ordering.js';
import { hasValidVoteTopology } from './vote-topology.js';

type Classification = { readonly outcome: string; readonly classification: string };

export type StructuredValidationCounters = {
  classificationExitInspections: number;
};

const hasValidClassifications = (
  region: ProgramRegion,
  classifications: readonly Classification[],
  counters?: StructuredValidationCounters,
): boolean => {
  if (
    !isStrictlySorted(classifications, ({ outcome }) => outcome) ||
    !sameOrderedKeys(
      region.exits,
      classifications,
      ({ outcome }) => outcome,
      ({ outcome }) => outcome,
    )
  ) {
    return false;
  }
  for (const [index, classification] of classifications.entries()) {
    const exit = region.exits[index];
    if (counters !== undefined) {
      counters.classificationExitInspections += 1;
    }
    if (
      exit === undefined ||
      (classification.classification === 'failed' && !isPipelineFailureSchema(exit.outputSchema))
    ) {
      return false;
    }
  }
  return true;
};

const hasValidGateAnswers = (
  node: Extract<ProgramNode, { readonly kind: 'humanGate' }>,
): boolean => {
  const routed = node.routes.answers.map(({ answer }) => answer);
  return (
    isStrictlySorted(node.answers, (answer) => answer) &&
    isStrictlySorted(routed, (answer) => answer) &&
    node.answers.length === routed.length &&
    node.answers.every((answer, index) => answer === routed[index])
  );
};

const hasSortedBranchKeys = (branches: readonly { readonly key: string }[]): boolean =>
  isStrictlySorted(branches, ({ key }) => key);

const hasValidParallel = (
  node: ProgramParallelNode,
  counters?: StructuredValidationCounters,
): boolean => {
  if (!hasSortedBranchKeys(node.branches)) {
    return false;
  }
  if (node.mode === 'generic') {
    return (
      (node.policy.kind !== 'threshold' || node.policy.count <= node.branches.length) &&
      node.branches.every(({ region, exits }) => hasValidClassifications(region, exits, counters))
    );
  }
  const count = node.branches.length;
  const validPolicy =
    node.policy.kind === 'unanimous' ||
    (node.policy.kind === 'quorum' && node.policy.minimumParticipation <= count) ||
    (node.policy.kind === 'independentThreshold' &&
      node.policy.approveThreshold <= count &&
      node.policy.rejectThreshold <= count &&
      node.policy.approveThreshold + node.policy.rejectThreshold > count);
  return validPolicy && hasValidVoteTopology(node);
};

export const hasValidStructuredSemantics = (
  node: ProgramNode,
  counters?: StructuredValidationCounters,
): boolean => {
  switch (node.kind) {
    case 'parallel':
      return hasValidParallel(node, counters);
    case 'repeat':
      return hasValidClassifications(node.body, node.bodyExits, counters);
    case 'map':
      return (
        node.maximumConcurrency <= Math.max(1, node.maximumItems) &&
        hasValidClassifications(node.body, node.bodyExits, counters)
      );
    case 'humanGate':
      return hasValidGateAnswers(node);
    case 'choice':
      return isStrictlySorted(node.cases, ({ key }) => key);
    case 'call':
      return isStrictlySorted(node.routes.outcomes, ({ outcome }) => outcome);
    case 'activity':
    case 'wait':
    case 'end':
      return true;
  }
  node satisfies never;
  return false;
};
