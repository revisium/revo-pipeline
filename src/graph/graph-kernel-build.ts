import type { GraphKernel } from './graph-kernel.js';

export type GraphKernelBuild =
  | { readonly ok: true; readonly kernel: GraphKernel }
  | {
      readonly ok: false;
      readonly reason: 'limit' | 'node-order' | 'foreign-edge';
      readonly offset: number;
    };
