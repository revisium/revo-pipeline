import { compareUnicodeCodePoints, isValidKey, isValidSemanticName } from '../../policy/index.js';
import type { CandidateVerdict } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { DecisionFaultCollector } from './decision-fault-collector.js';
type IndexedFact<T> = { readonly fact: T; readonly sourceIndex: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const keys = Object.keys(value).sort(compareUnicodeCodePoints);
  const expected = [...fields].sort(compareUnicodeCodePoints);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

export const validateCandidateVerdicts = (
  input: readonly unknown[],
  context: DecisionContext,
  faults: DecisionFaultCollector,
): readonly IndexedFact<CandidateVerdict>[] => {
  const seen = new Set<string>();
  const validated: IndexedFact<CandidateVerdict>[] = [];
  input.forEach((entry, index) => {
    const path = `/candidateVerdicts/${index}`;
    if (
      !isRecord(entry) ||
      !hasExactFields(entry, ['candidate', 'nodeKey', 'verdict']) ||
      !isValidKey(entry.nodeKey) ||
      !isValidSemanticName(entry.candidate) ||
      (entry.verdict !== 'abstain' && entry.verdict !== 'approve' && entry.verdict !== 'reject')
    ) {
      faults.add('FACT_TYPE', path, 'Invalid candidate verdict fact.');
      return;
    }
    const identity = `${entry.nodeKey}\u0000${entry.candidate}`;
    if (seen.has(identity)) {
      faults.add('FACT_DUPLICATE', path, 'Duplicate candidate verdict fact.');
      return;
    }
    seen.add(identity);
    const node = context.nodeByKey.get(entry.nodeKey);
    if (node?.kind !== 'consensus') {
      faults.add('FACT_FOREIGN', `${path}/nodeKey`, 'Foreign verdict node.');
      return;
    }
    if (!context.candidatesByNode.get(entry.nodeKey)?.has(entry.candidate)) {
      faults.add('FACT_CANDIDATE', `${path}/candidate`, 'Candidate is not declared.');
      return;
    }
    validated.push({
      fact: { nodeKey: entry.nodeKey, candidate: entry.candidate, verdict: entry.verdict },
      sourceIndex: index,
    });
  });
  return validated;
};
