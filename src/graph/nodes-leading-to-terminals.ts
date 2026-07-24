import type { CompiledEdge, NodeKey } from '../spec/index.js';

export const nodesLeadingToTerminals = (
  terminals: readonly NodeKey[],
  edges: readonly Pick<CompiledEdge, 'from' | 'to'>[],
): ReadonlySet<NodeKey> => {
  const incoming = new Map<NodeKey, NodeKey[]>();
  for (const edge of edges) {
    const sources = incoming.get(edge.to) ?? [];
    sources.push(edge.from);
    incoming.set(edge.to, sources);
  }
  const reached = new Set<NodeKey>();
  const pending = [...terminals];
  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined || reached.has(key)) {
      continue;
    }
    reached.add(key);
    pending.push(...(incoming.get(key) ?? []));
  }
  return reached;
};
