import { compareUnicodeCodePoints } from '../policy/index.js';
import type { CompiledEdge, NodeKey } from '../spec/index.js';

export const topologicalSort = (
  keys: readonly NodeKey[],
  edges: readonly Pick<CompiledEdge, 'from' | 'to'>[],
): readonly NodeKey[] | null => {
  const incoming = new Map(keys.map((key) => [key, 0]));
  const outgoing = new Map(keys.map((key) => [key, [] as NodeKey[]]));
  for (const edge of edges) {
    if (!incoming.has(edge.from) || !incoming.has(edge.to)) {
      continue;
    }
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const ready: NodeKey[] = [];
  const pushReady = (key: NodeKey): void => {
    ready.push(key);
    let index = ready.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareUnicodeCodePoints(ready[parent] ?? '', key) <= 0) {
        break;
      }
      ready[index] = ready[parent] ?? '';
      index = parent;
    }
    ready[index] = key;
  };
  const popReady = (): NodeKey | undefined => {
    const first = ready[0];
    const last = ready.pop();
    if (first === undefined || last === undefined || ready.length === 0) {
      return first;
    }
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= ready.length) {
        break;
      }
      const child =
        right < ready.length && compareUnicodeCodePoints(ready[right] ?? '', ready[left] ?? '') < 0
          ? right
          : left;
      if (compareUnicodeCodePoints(ready[child] ?? '', last) >= 0) {
        break;
      }
      ready[index] = ready[child] ?? '';
      index = child;
    }
    ready[index] = last;
    return first;
  };
  keys.filter((key) => incoming.get(key) === 0).forEach(pushReady);
  const result: NodeKey[] = [];
  while (ready.length > 0) {
    const key = popReady();
    if (key === undefined) {
      break;
    }
    result.push(key);
    for (const target of outgoing.get(key) ?? []) {
      const remaining = (incoming.get(target) ?? 0) - 1;
      incoming.set(target, remaining);
      if (remaining === 0) {
        pushReady(target);
      }
    }
  }
  return result.length === keys.length ? Object.freeze(result) : null;
};
