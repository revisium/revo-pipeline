export type ReadyDiscipline = 'fifo' | 'lifo';

export type TopologicalIndexOrder = {
  readonly indexes: readonly number[];
  readonly complete: boolean;
};

const hasValidTarget = (target: number, size: number): boolean =>
  Number.isSafeInteger(target) && target >= 0 && target < size;

const computeIndegrees = (outgoing: readonly (readonly number[])[]): number[] | null => {
  const indegrees = outgoing.map(() => 0);
  for (const targets of outgoing) {
    for (const target of targets) {
      if (!hasValidTarget(target, outgoing.length)) {
        return null;
      }
      indegrees[target] = (indegrees[target] ?? 0) + 1;
    }
  }
  return indegrees;
};

const hasReadyIndex = (
  ready: readonly number[],
  head: number,
  discipline: ReadyDiscipline,
): boolean => (discipline === 'fifo' ? head < ready.length : ready.length > 0);

const takeReadyIndex = (
  ready: number[],
  head: number,
  discipline: ReadyDiscipline,
): number | undefined => (discipline === 'fifo' ? ready[head] : ready.pop());

export const topologicalIndexes = (
  outgoing: readonly (readonly number[])[],
  discipline: ReadyDiscipline = 'lifo',
): TopologicalIndexOrder => {
  const indegrees = computeIndegrees(outgoing);
  if (indegrees === null) {
    return { indexes: [], complete: false };
  }

  const ready = indegrees.flatMap((degree, index) => (degree === 0 ? [index] : []));
  const ordered: number[] = [];
  let head = 0;
  while (hasReadyIndex(ready, head, discipline)) {
    const current = takeReadyIndex(ready, head, discipline);
    if (discipline === 'fifo') {
      head += 1;
    }
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
