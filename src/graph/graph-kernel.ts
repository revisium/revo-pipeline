import type { NodeKey } from '../spec/index.js';

export type GraphKernel = {
  readonly nodeKeys: readonly NodeKey[];
  readonly edgeFromOffsets: readonly number[];
  readonly edgeToOffsets: readonly number[];
  readonly incomingEdgeOffsets: readonly (readonly number[])[];
  readonly outgoingEdgeOffsets: readonly (readonly number[])[];
  readonly nodeOffset: (key: NodeKey) => number | undefined;
};
