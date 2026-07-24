import type { CompiledEdgeIndexEntry } from './compiled-edge-index-entry.js';
import type { CompiledEdge } from './compiled-edge.js';
import type { CompiledForkRegion } from './compiled-fork-region.js';
import type { CompiledNodeIndexEntry } from './compiled-node-index-entry.js';
import type { CompiledNode } from './compiled-node.js';
import type { FactDefinition } from './fact-definition.js';
import type { NodeKey } from './node-key.js';

export type CompiledPipeline = {
  readonly schemaVersion: 1;
  readonly entry: NodeKey;
  readonly facts: readonly FactDefinition[];
  readonly nodes: readonly CompiledNode[];
  readonly edges: readonly CompiledEdge[];
  readonly topologicalOrder: readonly NodeKey[];
  readonly forkRegions: readonly CompiledForkRegion[];
  readonly nodeIndex: readonly CompiledNodeIndexEntry[];
  readonly outgoingIndex: readonly CompiledEdgeIndexEntry[];
  readonly incomingIndex: readonly CompiledEdgeIndexEntry[];
};
