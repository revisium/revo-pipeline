import type { Digest } from '../../foundation/index.js';
import type { NodeTerminalResult } from '../contracts/results.js';
import { findSortedInsertionIndex } from '../program/lookup.js';

export type NodeResultOrderingCounters = {
  comparisons: number;
  assignments: number;
};

const assignResult = (
  output: Record<string, NodeTerminalResult>,
  nodeId: string,
  result: NodeTerminalResult,
  counters?: NodeResultOrderingCounters,
): void => {
  output[nodeId] = result;
  if (counters !== undefined) {
    counters.assignments += 1;
  }
};

export const insertCanonicalNodeResult = (
  results: Readonly<Record<string, NodeTerminalResult>>,
  nodeId: Digest,
  result: NodeTerminalResult,
  counters?: NodeResultOrderingCounters,
): Readonly<Record<string, NodeTerminalResult>> | null => {
  if (Object.hasOwn(results, nodeId)) {
    return null;
  }
  const keys = Object.keys(results);
  const insertion = findSortedInsertionIndex(
    keys,
    nodeId,
    (key) => key,
    () => {
      if (counters !== undefined) {
        counters.comparisons += 1;
      }
    },
  );
  const output: Record<string, NodeTerminalResult> = {};
  if (counters === undefined) {
    for (let index = 0; index < insertion; index += 1) {
      const key = keys[index]!;
      output[key] = results[key]!;
    }
    output[nodeId] = result;
    for (let index = insertion; index < keys.length; index += 1) {
      const key = keys[index]!;
      output[key] = results[key]!;
    }
    return Object.freeze(output);
  }
  for (let index = 0; index <= keys.length; index += 1) {
    if (index === insertion) {
      assignResult(output, nodeId, result, counters);
    }
    const key = keys[index];
    if (key !== undefined) {
      assignResult(output, key, results[key]!, counters);
    }
  }
  return Object.freeze(output);
};
