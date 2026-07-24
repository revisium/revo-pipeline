import type { CompiledEdge, NodeKey } from '../spec/index.js';

export const buildGraphAdjacency = (
  edges: readonly Pick<CompiledEdge, 'from' | 'to'>[],
): {
  readonly incoming: ReadonlyMap<NodeKey, readonly NodeKey[]>;
  readonly outgoing: ReadonlyMap<NodeKey, readonly NodeKey[]>;
} => {
  const incoming = new Map<NodeKey, NodeKey[]>();
  const outgoing = new Map<NodeKey, NodeKey[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.from) ?? [];
    targets.push(edge.to);
    outgoing.set(edge.from, targets);
    const sources = incoming.get(edge.to) ?? [];
    sources.push(edge.from);
    incoming.set(edge.to, sources);
  }
  return { incoming, outgoing };
};
