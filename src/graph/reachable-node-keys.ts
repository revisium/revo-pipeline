import type { CompiledEdge, NodeKey } from '../spec/index.js';

export const reachableNodeKeys = (
  start: NodeKey,
  edges: readonly Pick<CompiledEdge, 'from' | 'to'>[],
): ReadonlySet<NodeKey> => {
  const outgoing = new Map<NodeKey, NodeKey[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.from) ?? [];
    targets.push(edge.to);
    outgoing.set(edge.from, targets);
  }
  const reached = new Set<NodeKey>();
  const pending = [start];
  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined || reached.has(key)) {
      continue;
    }
    reached.add(key);
    pending.push(...(outgoing.get(key) ?? []));
  }
  return reached;
};
