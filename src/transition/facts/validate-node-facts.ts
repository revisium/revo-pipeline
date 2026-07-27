import { compareUnicodeCodePoints, isValidKey } from '../../policy/index.js';
import type { NodeFact, PipelineNode } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { DecisionFaultCollector } from './decision-fault-collector.js';
type IndexedFact<T> = { readonly fact: T; readonly sourceIndex: number };

const INVALID_PORTABLE_ENTRY = Symbol.for('revo-pipeline.invalid-portable-fact');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const keys = Object.keys(value).sort(compareUnicodeCodePoints);
  const expected = [...fields].sort(compareUnicodeCodePoints);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};
const nodeOutcomeExists = (node: PipelineNode, outcome: string): boolean => {
  if (node.kind === 'task' || node.kind === 'join' || node.kind === 'consensus') {
    return Object.hasOwn(node.outcomes, outcome);
  }
  if (node.kind === 'branch') {
    return node.cases.some((entry) => entry.name === outcome) || node.default?.name === outcome;
  }
  if (node.kind === 'fork') {
    return outcome === 'forked';
  }
  if (node.kind === 'humanGate') {
    return node.resolutions.some((route) => route.resolution === outcome);
  }
  return node.outcome === outcome;
};

export const validateNodeFacts = (
  input: readonly unknown[],
  context: DecisionContext,
  faults: DecisionFaultCollector,
): readonly IndexedFact<NodeFact>[] => {
  const seen = new Set<string>();
  const facts: IndexedFact<NodeFact>[] = [];
  input.forEach((entry, index) => {
    if (entry === INVALID_PORTABLE_ENTRY) {
      return;
    }
    const path = `/nodes/${index}`;
    if (!isRecord(entry) || !isValidKey(entry.key)) {
      faults.add('FACT_TYPE', path, 'Invalid node fact.');
      return;
    }
    const key = entry.key;
    const node = context.nodeByKey.get(key);
    if (seen.has(key)) {
      faults.add('FACT_DUPLICATE', `${path}/key`, 'Duplicate node fact.');
      return;
    }
    seen.add(key);
    if (!node) {
      faults.add('FACT_FOREIGN', `${path}/key`, 'Foreign node fact.');
      return;
    }
    if (entry.state === 'enabled') {
      if (!hasExactFields(entry, ['key', 'state'])) {
        faults.add('FACT_TYPE', path, 'Invalid enabled node fact.');
        return;
      }
      facts.push({ fact: { key, state: 'enabled' }, sourceIndex: index });
      return;
    }
    if (
      !hasExactFields(entry, ['key', 'outcome', 'state']) ||
      entry.state !== 'terminal' ||
      typeof entry.outcome !== 'string' ||
      !nodeOutcomeExists(node, entry.outcome)
    ) {
      faults.add('FACT_OUTCOME', `${path}/outcome`, 'Invalid node outcome.');
      return;
    }
    facts.push({ fact: { key, state: 'terminal', outcome: entry.outcome }, sourceIndex: index });
  });
  return facts;
};
