export const literalMapQueue = (
  items: number,
  bodyWork: number,
  continuationWork: number,
): number => {
  const queue = Array.from({ length: items }, () => bodyWork + 4);
  let work = 2 + items;
  while (queue.length > 0) {
    work += queue.shift() ?? 0;
  }
  return work + continuationWork;
};

export const literalParallelQueue = (branchWork: readonly number[]): number => {
  const queue = [...branchWork];
  let work = 2;
  while (queue.length > 0) {
    work += 1 + (queue.shift() ?? 0) + 2;
  }
  return work + 2;
};

export const permutations = <Value>(values: readonly Value[]): readonly (readonly Value[])[] => {
  if (values.length < 2) {
    return [values];
  }
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((remaining) => [
      value,
      ...remaining,
    ]),
  );
};

export const literalHypergraph = (sets: readonly (readonly number[])[], tokenCount: number) => {
  const memberships = sets.reduce((total, set) => total + set.length, 0);
  const degrees = Array.from(
    { length: tokenCount },
    (_, token) => sets.filter((set) => set.includes(token)).length,
  );
  return {
    envelope: {
      sets: sets.length,
      memberships,
      maximumTokenDegree: Math.max(0, ...degrees),
    },
    reverseWork: sets.length + memberships,
  };
};

export const literalAckWork = (sets: readonly Set<number>[], token: number): number => {
  const containing = sets.filter((set) => set.has(token));
  const emptied = containing.filter((set) => set.size === 1).length;
  for (const set of containing) {
    set.delete(token);
  }
  return 1 + containing.length + emptied;
};
