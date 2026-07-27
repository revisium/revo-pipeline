import {
  compareUnicodeCodePoints,
  isValidKey,
  isValidSemanticName,
  PIPELINE_LIMITS,
} from '../../policy/index.js';
import type { GateResolution } from '../../spec/index.js';
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

export const validateGateResolutions = (
  input: readonly unknown[],
  context: DecisionContext,
  faults: DecisionFaultCollector,
): readonly IndexedFact<GateResolution>[] => {
  const seen = new Set<string>();
  const validated: IndexedFact<GateResolution>[] = [];
  input.forEach((entry, index) => {
    if (entry === INVALID_PORTABLE_ENTRY) {
      return;
    }
    const path = `/gateResolutions/${index}`;
    if (
      !isRecord(entry) ||
      !hasExactFields(entry, ['nodeKey', 'resolution']) ||
      !isValidKey(entry.nodeKey) ||
      !isValidSemanticName(entry.resolution)
    ) {
      faults.add('FACT_TYPE', path, 'Invalid gate resolution fact.');
      return;
    }
    if (
      entry.resolution !== entry.resolution.normalize('NFC') ||
      Array.from(entry.resolution).length > PIPELINE_LIMITS.portable.displayCodePoints
    ) {
      faults.add('FACT_RESOLUTION', `${path}/resolution`, 'Invalid gate resolution.');
      return;
    }
    if (seen.has(entry.nodeKey)) {
      faults.add('FACT_DUPLICATE', path, 'Duplicate gate resolution fact.');
      return;
    }
    seen.add(entry.nodeKey);
    const node = context.nodeByKey.get(entry.nodeKey);
    if (node?.kind !== 'humanGate') {
      faults.add('FACT_FOREIGN', `${path}/nodeKey`, 'Foreign gate node.');
      return;
    }
    if (!context.resolutionsByNode.get(entry.nodeKey)?.has(entry.resolution)) {
      faults.add('FACT_RESOLUTION', `${path}/resolution`, 'Resolution is not declared.');
      return;
    }
    validated.push({
      fact: { nodeKey: entry.nodeKey, resolution: entry.resolution },
      sourceIndex: index,
    });
  });
  return validated;
};
