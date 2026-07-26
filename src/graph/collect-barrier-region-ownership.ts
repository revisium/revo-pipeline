import type { BarrierRegionOwnership } from './barrier-region-ownership.js';
import type { BarrierRegionQuery } from './barrier-region-query.js';
import type { GraphKernel } from './graph-kernel.js';
import type { GraphOperationSink } from './graph-operation-sink.js';

type OffsetTraversal = {
  readonly words: Uint32Array;
};

const wordCount = (kernel: GraphKernel): number => Math.ceil(kernel.nodeKeys.length / 32);

const assertQueries = (
  kernel: GraphKernel,
  queries: readonly BarrierRegionQuery[],
): number | undefined => {
  if (queries.length > kernel.nodeKeys.length || queries.length > 256) {
    return undefined;
  }
  let total = 0;
  for (const query of queries) {
    if (
      query.barrierNodeOffset < 0 ||
      query.barrierNodeOffset >= kernel.nodeKeys.length ||
      query.branches.length > 32
    ) {
      return undefined;
    }
    total += query.branches.length;
    if (!Number.isSafeInteger(total) || total > 32 * kernel.nodeKeys.length || total > 8192) {
      return undefined;
    }
    if (
      query.branches.some(
        (branch) =>
          branch.entryNodeOffset < 0 ||
          branch.entryNodeOffset >= kernel.nodeKeys.length ||
          branch.exitNodeOffset < 0 ||
          branch.exitNodeOffset >= kernel.nodeKeys.length,
      )
    ) {
      return undefined;
    }
  }
  return total;
};

const setBit = (words: Uint32Array, offset: number, sink: GraphOperationSink | undefined): void => {
  const word = Math.floor(offset / 32);
  sink?.add('bitsetWord', 1);
  words[word] = (words[word] ?? 0) | (1 << (offset % 32));
};

const hasBit = (
  words: Uint32Array,
  offset: number,
  sink: GraphOperationSink | undefined,
): boolean => {
  sink?.add('bitsetWord', 1);
  return ((words[Math.floor(offset / 32)] ?? 0) & (1 << (offset % 32))) !== 0;
};

const traverse = (
  kernel: GraphKernel,
  start: number,
  barrier: number,
  reverse: boolean,
  sink: GraphOperationSink | undefined,
): OffsetTraversal => {
  const visited = new Uint32Array(wordCount(kernel));
  const pending = [start];
  while (pending.length > 0) {
    const offset = pending.pop();
    if (offset === undefined || offset === barrier || hasBit(visited, offset, sink)) {
      continue;
    }
    setBit(visited, offset, sink);
    sink?.add('node', 1);
    const edges = reverse
      ? (kernel.incomingEdgeOffsets[offset] ?? [])
      : (kernel.outgoingEdgeOffsets[offset] ?? []);
    for (const edgeOffset of edges) {
      sink?.add('edge', 1);
      const next = reverse ? kernel.edgeFromOffsets[edgeOffset] : kernel.edgeToOffsets[edgeOffset];
      if (next !== undefined) {
        pending.push(next);
      }
    }
  }
  return { words: visited };
};

const offsetsFromWords = (
  words: Uint32Array,
  nodeCount: number,
  barrier: number,
  sink: GraphOperationSink | undefined,
): readonly number[] => {
  const offsets: number[] = [];
  for (let wordOffset = 0; wordOffset < words.length; wordOffset += 1) {
    sink?.add('bitsetWord', 1);
    let bits = words[wordOffset] ?? 0;
    while (bits !== 0) {
      sink?.add('bitsetWord', 1);
      const bit = bits & -bits;
      const offset = wordOffset * 32 + (31 - Math.clz32(bit));
      if (offset < nodeCount && offset !== barrier) {
        offsets.push(offset);
      }
      sink?.add('bitsetWord', 1);
      bits &= bits - 1;
    }
  }
  return Object.freeze(offsets);
};

const ownershipFromBranchWords = (
  kernel: GraphKernel,
  barrier: number,
  branchWords: readonly Uint32Array[],
  priorOwners: Set<number>,
  sink: GraphOperationSink | undefined,
): BarrierRegionOwnership => {
  const localOwners = new Set<number>();
  const overlap = new Set<number>();
  const foreign = new Set<number>();
  const membersByBranch = branchWords.map((words) => {
    const members = offsetsFromWords(words, kernel.nodeKeys.length, barrier, sink);
    for (const member of members) {
      sink?.add('region', 1);
      if (localOwners.has(member) && !overlap.has(member)) {
        sink?.add('region', 1);
        overlap.add(member);
      }
      if (priorOwners.has(member) && !foreign.has(member)) {
        sink?.add('region', 1);
        foreign.add(member);
      }
      localOwners.add(member);
    }
    return members;
  });
  for (const member of localOwners) {
    priorOwners.add(member);
  }
  return Object.freeze({
    membersByBranch: Object.freeze(membersByBranch),
    overlappingNodeOffsets: Object.freeze([...overlap].sort((left, right) => left - right)),
    foreignRegionNodeOffsets: Object.freeze([...foreign].sort((left, right) => left - right)),
  });
};

const mergeWords = (
  destination: Uint32Array,
  source: Uint32Array,
  sink: GraphOperationSink | undefined,
): void => {
  for (let word = 0; word < destination.length; word += 1) {
    sink?.add('bitsetWord', 1);
    destination[word] = (destination[word] ?? 0) | (source[word] ?? 0);
  }
};

const sharedForwardRows = (
  kernel: GraphKernel,
  topologicalOffsets: readonly number[],
  words: number,
  sink: GraphOperationSink | undefined,
): readonly Uint32Array[] => {
  const forward = Array.from({ length: kernel.nodeKeys.length }, () => new Uint32Array(words));
  for (const offset of [...topologicalOffsets].reverse()) {
    const row = forward[offset];
    if (!row) {
      continue;
    }
    setBit(row, offset, sink);
    for (const edgeOffset of kernel.outgoingEdgeOffsets[offset] ?? []) {
      sink?.add('edge', 1);
      const target = kernel.edgeToOffsets[edgeOffset];
      const source = target === undefined ? undefined : forward[target];
      if (!source) {
        continue;
      }
      mergeWords(row, source, sink);
    }
  }
  return forward;
};

const sharedReverseRows = (
  kernel: GraphKernel,
  topologicalOffsets: readonly number[],
  words: number,
  sink: GraphOperationSink | undefined,
): readonly Uint32Array[] => {
  const reverse = Array.from({ length: kernel.nodeKeys.length }, () => new Uint32Array(words));
  for (const offset of topologicalOffsets) {
    const row = reverse[offset];
    if (!row) {
      continue;
    }
    setBit(row, offset, sink);
    for (const edgeOffset of kernel.outgoingEdgeOffsets[offset] ?? []) {
      sink?.add('edge', 1);
      const targetOffset = kernel.edgeToOffsets[edgeOffset];
      const target = targetOffset === undefined ? undefined : reverse[targetOffset];
      if (!target) {
        continue;
      }
      mergeWords(target, row, sink);
    }
  }
  return reverse;
};

const sharedRows = (
  kernel: GraphKernel,
  topologicalOffsets: readonly number[],
  sink: GraphOperationSink | undefined,
): { readonly forward: readonly Uint32Array[]; readonly reverse: readonly Uint32Array[] } => {
  const words = wordCount(kernel);
  const forward = sharedForwardRows(kernel, topologicalOffsets, words, sink);
  const reverse = sharedReverseRows(kernel, topologicalOffsets, words, sink);
  return { forward, reverse };
};

const sharedBranchWords = (
  kernel: GraphKernel,
  query: BarrierRegionQuery,
  rows: ReturnType<typeof sharedRows>,
  sink: GraphOperationSink | undefined,
): readonly Uint32Array[] => {
  return query.branches.map((branch) => {
    sink?.add('region', 1);
    const result = new Uint32Array(wordCount(kernel));
    const forward = rows.forward[branch.entryNodeOffset];
    const reverse = rows.reverse[branch.exitNodeOffset];
    for (let word = 0; word < result.length; word += 1) {
      sink?.add('bitsetWord', 1);
      result[word] = (forward?.[word] ?? 0) & (reverse?.[word] ?? 0);
    }
    return result;
  });
};

const fallbackBranchWords = (
  kernel: GraphKernel,
  query: BarrierRegionQuery,
  sink: GraphOperationSink | undefined,
): readonly Uint32Array[] => {
  return query.branches.map((branch) => {
    sink?.add('region', 1);
    const forward = traverse(kernel, branch.entryNodeOffset, query.barrierNodeOffset, false, sink);
    const reverse = traverse(kernel, branch.exitNodeOffset, query.barrierNodeOffset, true, sink);
    const result = new Uint32Array(wordCount(kernel));
    for (let word = 0; word < result.length; word += 1) {
      sink?.add('bitsetWord', 1);
      result[word] = (forward.words[word] ?? 0) & (reverse.words[word] ?? 0);
    }
    return result;
  });
};

const sharedQueryIsBarrierSafe = (
  query: BarrierRegionQuery,
  topologicalPositions: Uint16Array,
): boolean => {
  const barrierPosition = topologicalPositions[query.barrierNodeOffset];
  return (
    barrierPosition !== undefined &&
    query.branches.every((branch) => {
      const entryPosition = topologicalPositions[branch.entryNodeOffset];
      const exitPosition = topologicalPositions[branch.exitNodeOffset];
      return (
        entryPosition !== undefined &&
        exitPosition !== undefined &&
        entryPosition < barrierPosition &&
        exitPosition < barrierPosition
      );
    })
  );
};

const ownershipWithSharedRows = (
  kernel: GraphKernel,
  topologicalOffsets: readonly number[],
  queries: readonly BarrierRegionQuery[],
  sink: GraphOperationSink | undefined,
): readonly BarrierRegionOwnership[] => {
  const rows = sharedRows(kernel, topologicalOffsets, sink);
  const topologicalPositions = new Uint16Array(kernel.nodeKeys.length);
  for (let position = 0; position < topologicalOffsets.length; position += 1) {
    const offset = topologicalOffsets[position];
    if (offset !== undefined) {
      sink?.add('node', 1);
      topologicalPositions[offset] = position;
    }
  }
  const priorOwners = new Set<number>();
  return Object.freeze(
    queries.map((query) => {
      const branchWords = sharedQueryIsBarrierSafe(query, topologicalPositions)
        ? sharedBranchWords(kernel, query, rows, sink)
        : fallbackBranchWords(kernel, query, sink);
      return ownershipFromBranchWords(
        kernel,
        query.barrierNodeOffset,
        branchWords,
        priorOwners,
        sink,
      );
    }),
  );
};

const fallbackOwnership = (
  kernel: GraphKernel,
  queries: readonly BarrierRegionQuery[],
  sink: GraphOperationSink | undefined,
): readonly BarrierRegionOwnership[] => {
  const priorOwners = new Set<number>();
  return Object.freeze(
    queries.map((query) =>
      ownershipFromBranchWords(
        kernel,
        query.barrierNodeOffset,
        fallbackBranchWords(kernel, query, sink),
        priorOwners,
        sink,
      ),
    ),
  );
};

const isTopologicalOrder = (
  kernel: GraphKernel,
  topologicalOffsets: readonly number[],
  sink: GraphOperationSink | undefined,
): boolean => {
  if (topologicalOffsets.length !== kernel.nodeKeys.length) {
    return false;
  }
  const positions = new Int16Array(kernel.nodeKeys.length);
  positions.fill(-1);
  for (let position = 0; position < topologicalOffsets.length; position += 1) {
    sink?.add('node', 1);
    const offset = topologicalOffsets[position];
    if (
      offset === undefined ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= kernel.nodeKeys.length ||
      positions[offset] !== -1
    ) {
      return false;
    }
    positions[offset] = position;
  }
  for (let edgeOffset = 0; edgeOffset < kernel.edgeFromOffsets.length; edgeOffset += 1) {
    sink?.add('edge', 1);
    const from = kernel.edgeFromOffsets[edgeOffset];
    const to = kernel.edgeToOffsets[edgeOffset];
    if (
      from === undefined ||
      to === undefined ||
      (positions[from] ?? -1) >= (positions[to] ?? -1)
    ) {
      return false;
    }
  }
  return true;
};

export const collectBarrierRegionOwnership = (
  kernel: GraphKernel,
  topologicalOffsets: readonly number[] | null,
  queries: readonly BarrierRegionQuery[],
  instrumentation?: GraphOperationSink,
): readonly BarrierRegionOwnership[] => {
  if (assertQueries(kernel, queries) === undefined) {
    return Object.freeze([]);
  }
  if (queries.length === 0) {
    return Object.freeze([]);
  }
  const validTopology =
    topologicalOffsets !== null && isTopologicalOrder(kernel, topologicalOffsets, instrumentation);
  return validTopology
    ? ownershipWithSharedRows(kernel, topologicalOffsets, queries, instrumentation)
    : fallbackOwnership(kernel, queries, instrumentation);
};
