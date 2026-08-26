import type { AgentSlotStrategy, SourceNode, SourceRegion } from '../../source/index.js';
import { createIndexedDag, reachableFrom, type IndexedDag } from '../graph/indexed-dag.js';
import { sourceRoutes, type SourceRouteStatus } from '../source-routes.js';

export type RouteStatus = SourceRouteStatus;

type RouteEdge = { readonly target: string; readonly status: RouteStatus };

export type RegionRouteFacts = {
  readonly nodesByKey: ReadonlyMap<string, SourceNode>;
  readonly isReachable: (node: string) => boolean;
  readonly statusDominates: (
    producer: string,
    consumer: string,
    status: 'succeeded' | 'failed',
  ) => boolean;
};

const bitIsSet = (bits: Uint32Array, index: number): boolean =>
  ((bits[index >>> 5] ?? 0) & (1 << (index & 31))) !== 0;

const setBit = (bits: Uint32Array, index: number): void => {
  const wordIndex = index >>> 5;
  bits[wordIndex] = (bits[wordIndex] ?? 0) | (1 << (index & 31));
};

const intersectBits = (target: Uint32Array, other: Uint32Array): void => {
  for (let wordIndex = 0; wordIndex < target.length; wordIndex += 1) {
    target[wordIndex] = (target[wordIndex] ?? 0) & (other[wordIndex] ?? 0);
  }
};

const includeBits = (target: Uint32Array, other: Uint32Array): void => {
  for (let wordIndex = 0; wordIndex < target.length; wordIndex += 1) {
    target[wordIndex] = (target[wordIndex] ?? 0) | (other[wordIndex] ?? 0);
  }
};

const requiredBits = (rows: readonly Uint32Array[], index: number): Uint32Array => {
  const bits = rows[index];
  if (bits === undefined) {
    throw new TypeError('Expected an indexed route node.');
  }
  return bits;
};

const selectedDominators = (
  graph: IndexedDag,
  selectedReachable: Uint8Array,
  wordCount: number,
): readonly Uint32Array[] => {
  const dominators = graph.outgoing.map(() => new Uint32Array(wordCount));
  for (const nodeIndex of graph.topologicalOrder) {
    if (selectedReachable[nodeIndex] === 0) {
      continue;
    }
    const predecessors = requiredBits(graph.predecessors, nodeIndex).filter(
      (predecessorIndex) => selectedReachable[predecessorIndex] !== 0,
    );
    const bits = requiredBits(dominators, nodeIndex);
    const firstPredecessor = predecessors[0];
    if (firstPredecessor !== undefined) {
      bits.set(requiredBits(dominators, firstPredecessor));
      for (const predecessorIndex of predecessors.subarray(1)) {
        intersectBits(bits, requiredBits(dominators, predecessorIndex));
      }
    }
    setBit(bits, nodeIndex);
  }
  return dominators;
};

export const analyzeRouteFacts = (
  region: SourceRegion,
  selectedAgentStrategy: (node: SourceNode) => AgentSlotStrategy | undefined,
): RegionRouteFacts => {
  const keys = region.nodes.map(({ id }) => id);
  const nodesByKey = new Map(region.nodes.map((node) => [node.id, node]));
  const edges: readonly (readonly RouteEdge[])[] = region.nodes.map((node) =>
    sourceRoutes(node, selectedAgentStrategy(node)),
  );
  const graph = createIndexedDag(
    keys,
    edges.map((outgoing) => outgoing.map(({ target }) => target)),
  );
  const entryIndex = graph.indexByKey.get(region.entry);
  if (entryIndex === undefined) {
    throw new TypeError('Expected a validated region entry.');
  }
  const selectedReachable = reachableFrom(graph, entryIndex);
  const wordCount = Math.ceil(keys.length / 32);
  const dominators = selectedDominators(graph, selectedReachable, wordCount);

  const reachable = keys.map(() => new Uint32Array(wordCount));
  for (let orderIndex = graph.topologicalOrder.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const nodeIndex = graph.topologicalOrder[orderIndex];
    if (nodeIndex === undefined) {
      throw new TypeError('Expected an indexed route node.');
    }
    const bits = requiredBits(reachable, nodeIndex);
    setBit(bits, nodeIndex);
    for (const targetIndex of graph.outgoing[nodeIndex] ?? []) {
      includeBits(bits, requiredBits(reachable, targetIndex));
    }
  }

  return Object.freeze({
    nodesByKey,
    isReachable: (node) => {
      const nodeIndex = graph.indexByKey.get(node);
      return nodeIndex !== undefined && selectedReachable[nodeIndex] !== 0;
    },
    statusDominates: (producer, consumer, status) => {
      const producerIndex = graph.indexByKey.get(producer);
      const consumerIndex = graph.indexByKey.get(consumer);
      if (
        producerIndex === undefined ||
        consumerIndex === undefined ||
        !bitIsSet(requiredBits(dominators, consumerIndex), producerIndex)
      ) {
        return false;
      }
      let reachesConsumer = false;
      for (const edge of edges[producerIndex] ?? []) {
        const targetIndex = graph.indexByKey.get(edge.target);
        if (
          targetIndex !== undefined &&
          bitIsSet(requiredBits(reachable, targetIndex), consumerIndex)
        ) {
          reachesConsumer = true;
          if (edge.status !== status) {
            return false;
          }
        }
      }
      return reachesConsumer;
    },
  });
};
