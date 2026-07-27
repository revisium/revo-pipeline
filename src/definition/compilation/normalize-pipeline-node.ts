import { compareUnicodeCodePoints, normalizeJsonScalar } from '../../policy/index.js';
import type { BranchCase, JsonScalar, PipelineNode } from '../../spec/index.js';

const scalarTypeRank = (value: JsonScalar): number => {
  if (value === null) {
    return 0;
  }
  if (typeof value === 'boolean') {
    return 1;
  }
  return typeof value === 'number' ? 2 : 3;
};

const scalarComparator = (left: JsonScalar, right: JsonScalar): number => {
  const rank = scalarTypeRank(left) - scalarTypeRank(right);
  if (rank !== 0) {
    return rank;
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return compareUnicodeCodePoints(left, right);
  }
  return 0;
};

const normalizeCase = (entry: BranchCase): BranchCase => ({
  name: entry.name,
  to: entry.to,
  when:
    entry.when.op === 'equals'
      ? { op: 'equals', value: normalizeJsonScalar(entry.when.value) }
      : {
          op: 'oneOf',
          values: entry.when.values.map(normalizeJsonScalar).sort(scalarComparator),
        },
});

export const normalizePipelineNode = (node: PipelineNode): PipelineNode => {
  switch (node.kind) {
    case 'task':
      return { kind: 'task', key: node.key, outcomes: { ...node.outcomes } };
    case 'branch':
      return {
        kind: 'branch',
        key: node.key,
        fact: node.fact,
        cases: node.cases
          .map(normalizeCase)
          .sort(
            (left, right) =>
              compareUnicodeCodePoints(left.name, right.name) ||
              compareUnicodeCodePoints(left.to, right.to),
          ),
        default: node.default ? { ...node.default } : null,
      };
    case 'fork':
      return {
        kind: 'fork',
        key: node.key,
        join: node.join,
        branches: node.branches
          .map((branch) => ({ ...branch }))
          .sort(
            (left, right) =>
              compareUnicodeCodePoints(left.name, right.name) ||
              compareUnicodeCodePoints(left.entry, right.entry),
          ),
      };
    case 'join':
      return {
        kind: 'join',
        key: node.key,
        fork: node.fork,
        policy: { ...node.policy },
        outcomes: { ...node.outcomes },
      };
    case 'consensus':
      return {
        kind: 'consensus',
        key: node.key,
        candidates: [...node.candidates].sort(compareUnicodeCodePoints),
        policy: { ...node.policy },
        outcomes: { ...node.outcomes },
      };
    case 'humanGate':
      return {
        kind: 'humanGate',
        key: node.key,
        subject: node.subject.normalize('NFC'),
        resolutions: node.resolutions
          .map((resolution) => ({ ...resolution }))
          .sort(
            (left, right) =>
              compareUnicodeCodePoints(left.resolution, right.resolution) ||
              compareUnicodeCodePoints(left.to, right.to),
          ),
      };
    case 'terminal':
      return { kind: 'terminal', key: node.key, outcome: node.outcome.normalize('NFC') };
  }
  throw new Error('Unsupported pipeline node.');
};
