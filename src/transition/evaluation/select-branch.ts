import { jsonScalarsEqual } from '../../policy/index.js';
import type { BranchNode } from '../../spec/index.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';
import type { Selection } from './selection.js';

export const selectBranch = (node: BranchNode, facts: ValidatedFacts): Selection | undefined => {
  const value = facts.valueByKey.get(node.fact);
  if (value === undefined) {
    return undefined;
  }
  const match = node.cases.find((entry) =>
    entry.when.op === 'equals'
      ? jsonScalarsEqual(entry.when.value, value)
      : entry.when.values.some((candidate) => jsonScalarsEqual(candidate, value)),
  );
  const selected = match ?? node.default;
  return selected ? { outcome: selected.name, targets: [selected.to] } : undefined;
};
