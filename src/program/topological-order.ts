export type ReadyDiscipline = 'fifo' | 'lifo';

export type TopologicalIndexOrder = {
  readonly indexes: readonly number[];
  readonly complete: boolean;
};

export const topologicalIndexes = (
  outgoing: readonly (readonly number[])[],
  discipline: ReadyDiscipline = 'lifo',
): TopologicalIndexOrder => {
  const indegrees = outgoing.map(() => 0);
  for (const targets of outgoing) {
    for (const target of targets) {
      if (!Number.isSafeInteger(target) || target < 0 || target >= outgoing.length) {
        return { indexes: [], complete: false };
      }
      indegrees[target] = (indegrees[target] ?? 0) + 1;
    }
  }

  const ready = indegrees.flatMap((degree, index) => (degree === 0 ? [index] : []));
  const ordered: number[] = [];
  let head = 0;
  while (discipline === 'fifo' ? head < ready.length : ready.length > 0) {
    const current = discipline === 'fifo' ? ready[head++] : ready.pop();
    if (current === undefined) {
      break;
    }
    ordered.push(current);
    for (const target of outgoing[current] ?? []) {
      const degree = (indegrees[target] ?? 0) - 1;
      indegrees[target] = degree;
      if (degree === 0) {
        ready.push(target);
      }
    }
  }
  return { indexes: ordered, complete: ordered.length === outgoing.length };
};
