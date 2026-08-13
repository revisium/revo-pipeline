import { EmptyObjectSchema } from '../../src/foundation/index.js';
import {
  analyzeProgram,
  type PipelineProgram,
  type ProgramMapNode,
  type ProgramNode,
  type ProgramNodeId,
  type ProgramParallelBranch,
  type ProgramRegion,
} from '../../src/program/index.js';
import { literalMapQueue } from './admission-reference-model.js';

let nextIdentity = 1;
const identity = (): ProgramNodeId => `sha256:${(nextIdentity++).toString(16).padStart(64, '0')}`;

const nonEmptyNodes = (nodes: readonly ProgramNode[]): [ProgramNode, ...ProgramNode[]] => {
  const [first, ...remaining] = nodes;
  if (first === undefined) {
    throw new TypeError('Expected a non-empty reference region.');
  }
  return [first, ...remaining];
};

const atLeastTwoBranches = (
  branches: readonly ProgramParallelBranch[],
): [ProgramParallelBranch, ProgramParallelBranch, ...ProgramParallelBranch[]] => {
  const [first, second, ...remaining] = branches;
  if (first === undefined || second === undefined) {
    throw new TypeError('Expected at least two reference branches.');
  }
  return [first, second, ...remaining];
};

const syncRegion = (work: number): ProgramRegion => {
  const endId = identity();
  let target = endId;
  const nodes: ProgramNode[] = [{ kind: 'end', id: endId, outcome: 'ok', output: {} }];
  for (let index = 0; index < work - 2; index += 1) {
    const id = identity();
    nodes.push({
      kind: 'choice',
      id,
      selector: { kind: 'literal', value: true },
      cases: [{ key: 'next', when: { kind: 'equals', value: true }, target }],
      otherwise: target,
    });
    target = id;
  }
  return {
    id: identity(),
    inputSchema: EmptyObjectSchema,
    entry: target,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'ok', outputSchema: EmptyObjectSchema }],
    nodes: nonEmptyNodes(nodes.sort((left, right) => left.id.localeCompare(right.id))),
  };
};

const mapNode = (
  items: number,
  bodyWork: number,
  next: ProgramNodeId,
  concurrency = 1,
): ProgramMapNode => ({
  kind: 'map',
  id: identity(),
  items: { kind: 'literal', value: Array.from({ length: items }, (_, index) => `item-${index}`) },
  itemKeyPointer: '',
  maximumItems: items,
  maximumConcurrency: Math.min(concurrency, Math.max(1, items)),
  bodyInput: {},
  body: syncRegion(bodyWork),
  bodyExits: [{ outcome: 'ok', classification: 'completed' }],
  failure: { kind: 'collect' },
  routes: { completed: next, failed: next, cancelled: next },
});

const mapWithBody = (
  items: number,
  concurrency: number,
  body: ProgramRegion,
  next: ProgramNodeId,
): ProgramMapNode => ({ ...mapNode(items, 2, next, concurrency), body });

export const mapRegion = (
  items: number,
  bodyWork: number,
  continuationWork: number,
  concurrency = 1,
): ProgramRegion => {
  const continuation = syncRegion(continuationWork);
  const map = mapNode(items, bodyWork, continuation.entry, concurrency);
  return {
    ...continuation,
    id: identity(),
    entry: map.id,
    nodes: nonEmptyNodes(
      [map, ...continuation.nodes].sort((left, right) => left.id.localeCompare(right.id)),
    ),
  };
};

export const program = (region: ProgramRegion): PipelineProgram => ({
  schemaVersion: 'pipeline-program/v1',
  key: 'reference',
  sourceDigest: identity(),
  materializationDigest: identity(),
  entryModule: 'main',
  maximumTotalActivities: 1_000_000,
  modules: [
    { key: 'main', inputSchema: EmptyObjectSchema, outputSchema: region.outputSchema, region },
  ],
});

export const productionWork = (region: ProgramRegion) =>
  analyzeProgram(program(region)).analysis.work;

export const nestedMap = (
  depth: number,
  weight: number,
): { region: ProgramRegion; work: number } => {
  if (depth === 0) {
    return { region: syncRegion(weight + 2), work: weight + 2 };
  }
  const child = nestedMap(depth - 1, weight);
  const continuation = syncRegion(2);
  const node = mapWithBody(2, 2, child.region, continuation.entry);
  return {
    work: literalMapQueue(2, child.work, 2),
    region: {
      ...continuation,
      id: identity(),
      entry: node.id,
      nodes: [node, ...continuation.nodes],
    },
  };
};

export const tinyParallel = (works: readonly number[]): ProgramRegion => {
  const continuation = syncRegion(2);
  const branches: ProgramParallelBranch[] = works.map((work, index) => ({
    key: `branch-${index}`,
    input: {},
    region: syncRegion(work),
    exits: [{ outcome: 'ok', classification: 'qualifies' }],
  }));
  const node: ProgramNode = {
    kind: 'parallel',
    id: identity(),
    mode: 'generic',
    branches: atLeastTwoBranches(branches),
    policy: { kind: 'all' },
    remaining: 'drain',
    next: continuation.entry,
  };
  return { ...continuation, id: identity(), entry: node.id, nodes: [node, ...continuation.nodes] };
};

export const parallelRegion = (branchWork: number): ProgramRegion => {
  const continuation = syncRegion(2);
  const branches: ProgramParallelBranch[] = ['left', 'right'].map((key) => ({
    key,
    input: {},
    region: mapRegion(101, 391, 2),
    exits: [{ outcome: 'ok', classification: 'qualifies' }],
  }));
  if (literalMapQueue(101, 391, 2) !== branchWork) {
    throw new TypeError('Parallel reference branch work mismatch.');
  }
  const parallel: ProgramNode = {
    kind: 'parallel',
    id: identity(),
    mode: 'generic',
    branches: atLeastTwoBranches(branches),
    policy: { kind: 'all' },
    remaining: 'drain',
    next: continuation.entry,
  };
  return {
    ...continuation,
    id: identity(),
    entry: parallel.id,
    nodes: nonEmptyNodes([parallel, ...continuation.nodes]),
  };
};
