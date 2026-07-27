import type { CompiledEdge, CompiledForkRegion, NodeKey } from '../../spec/index.js';

export type ExpectedCompiledSemantics = {
  readonly nodeKeys: readonly NodeKey[];
  readonly edges: readonly CompiledEdge[];
  readonly regions: readonly CompiledForkRegion[];
};
