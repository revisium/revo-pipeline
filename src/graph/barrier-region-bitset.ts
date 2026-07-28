import type { GraphKernel } from './graph-kernel.js';
import type { GraphOperationSink } from './graph-operation-sink.js';

const wordCount = (kernel: GraphKernel): number => Math.ceil(kernel.nodeKeys.length / 32);

const set = (words: Uint32Array, offset: number, sink: GraphOperationSink | undefined): void => {
  const word = Math.floor(offset / 32);
  sink?.add('bitsetWord', 1);
  words[word] = (words[word] ?? 0) | (1 << (offset % 32));
};

const has = (words: Uint32Array, offset: number, sink: GraphOperationSink | undefined): boolean => {
  sink?.add('bitsetWord', 1);
  return ((words[Math.floor(offset / 32)] ?? 0) & (1 << (offset % 32))) !== 0;
};

const merge = (
  destination: Uint32Array,
  source: Uint32Array,
  sink: GraphOperationSink | undefined,
): void => {
  for (let word = 0; word < destination.length; word += 1) {
    sink?.add('bitsetWord', 1);
    destination[word] = (destination[word] ?? 0) | (source[word] ?? 0);
  }
};

const offsets = (
  words: Uint32Array,
  nodeCount: number,
  barrier: number,
  sink: GraphOperationSink | undefined,
): readonly number[] => {
  const result: number[] = [];
  for (let wordOffset = 0; wordOffset < words.length; wordOffset += 1) {
    sink?.add('bitsetWord', 1);
    let bits = words[wordOffset] ?? 0;
    while (bits !== 0) {
      sink?.add('bitsetWord', 1);
      const bit = bits & -bits;
      const offset = wordOffset * 32 + (31 - Math.clz32(bit));
      if (offset < nodeCount && offset !== barrier) {
        result.push(offset);
      }
      sink?.add('bitsetWord', 1);
      bits &= bits - 1;
    }
  }
  return Object.freeze(result);
};

export const barrierRegionBitset = Object.freeze({ has, merge, offsets, set, wordCount });
