export type IndexedDag = {
  readonly indexByKey: ReadonlyMap<string, number>;
  readonly outgoing: readonly Uint32Array[];
  readonly predecessors: readonly Uint32Array[];
  readonly topologicalOrder: readonly number[];
};

const invalidDag = (): never => {
  throw new TypeError('Expected a validated acyclic region graph.');
};

export const createIndexedDag = (
  keys: readonly string[],
  outgoingKeys: readonly (readonly string[])[],
): IndexedDag => {
  if (keys.length !== outgoingKeys.length) {
    return invalidDag();
  }

  const indexByKey = new Map(keys.map((key, index) => [key, index]));
  if (indexByKey.size !== keys.length) {
    return invalidDag();
  }

  const predecessorLists = Array.from({ length: keys.length }, () => [] as number[]);
  const outgoing = outgoingKeys.map((targets, sourceIndex) => {
    const targetIndexes = targets.map((target) => indexByKey.get(target) ?? invalidDag());
    for (const targetIndex of targetIndexes) {
      predecessorLists[targetIndex]?.push(sourceIndex);
    }
    return new Uint32Array(targetIndexes);
  });
  const predecessors = predecessorLists.map((indexes) => new Uint32Array(indexes));
  const remainingPredecessors = new Uint32Array(predecessors.map((indexes) => indexes.length));
  const pending = keys.flatMap((_, index) => (remainingPredecessors[index] === 0 ? [index] : []));
  const topologicalOrder: number[] = [];
  for (const sourceIndex of pending) {
    topologicalOrder.push(sourceIndex);
    for (const targetIndex of outgoing[sourceIndex] ?? []) {
      remainingPredecessors[targetIndex] = (remainingPredecessors[targetIndex] ?? 0) - 1;
      if (remainingPredecessors[targetIndex] === 0) {
        pending.push(targetIndex);
      }
    }
  }
  if (topologicalOrder.length !== keys.length) {
    return invalidDag();
  }

  return Object.freeze({
    indexByKey,
    outgoing: Object.freeze(outgoing),
    predecessors: Object.freeze(predecessors),
    topologicalOrder: Object.freeze(topologicalOrder),
  });
};

export const reachableFrom = (graph: IndexedDag, startIndex: number): Uint8Array => {
  if (!Number.isSafeInteger(startIndex) || startIndex < 0 || startIndex >= graph.outgoing.length) {
    return invalidDag();
  }
  const reachable = new Uint8Array(graph.outgoing.length);
  const pending = [startIndex];
  reachable[startIndex] = 1;
  for (const sourceIndex of pending) {
    for (const targetIndex of graph.outgoing[sourceIndex] ?? []) {
      if (reachable[targetIndex] === 0) {
        reachable[targetIndex] = 1;
        pending.push(targetIndex);
      }
    }
  }
  return reachable;
};
