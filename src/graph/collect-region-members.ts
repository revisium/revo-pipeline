import type { NodeKey } from '../spec/index.js';

export const collectRegionMembers = (
  entry: NodeKey,
  exit: NodeKey,
  join: NodeKey,
  adjacency: {
    readonly incoming: ReadonlyMap<NodeKey, readonly NodeKey[]>;
    readonly outgoing: ReadonlyMap<NodeKey, readonly NodeKey[]>;
  },
): ReadonlySet<NodeKey> => {
  const reachable = new Set<NodeKey>();
  const pending = [entry];
  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined || key === join || reachable.has(key)) {
      continue;
    }
    reachable.add(key);
    pending.push(...(adjacency.outgoing.get(key) ?? []));
  }
  const leadingToExit = new Set<NodeKey>();
  const reversePending = [exit];
  while (reversePending.length > 0) {
    const key = reversePending.pop();
    if (key === undefined || key === join || leadingToExit.has(key)) {
      continue;
    }
    leadingToExit.add(key);
    reversePending.push(...(adjacency.incoming.get(key) ?? []));
  }
  return new Set([...reachable].filter((key) => leadingToExit.has(key)));
};
