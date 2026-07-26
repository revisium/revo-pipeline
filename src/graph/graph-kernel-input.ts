import type { NodeKey } from '../spec/index.js';

export type GraphKernelInput = {
  readonly nodeKeys: readonly NodeKey[];
  readonly edges: readonly {
    readonly from: NodeKey;
    readonly to: NodeKey;
  }[];
};
