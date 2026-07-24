import type { NodeKey } from './node-key.js';

export type CompiledEdgeIndexEntry = { readonly key: NodeKey; readonly edges: readonly number[] };
