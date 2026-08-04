import type { CompiledNode, CompiledPipeline } from '../../spec/index.js';

export interface DecisionContext {
  readonly compiled: { readonly snapshot: CompiledPipeline };
  readonly candidatesByNode: ReadonlyMap<string, ReadonlySet<string>>;
  readonly incomingByKey: ReadonlyMap<string, readonly number[]>;
  readonly nodeByKey: ReadonlyMap<string, CompiledNode>;
  readonly outgoingByKey: ReadonlyMap<string, readonly number[]>;
  readonly regionByFork: ReadonlyMap<string, CompiledPipeline['forkRegions'][number]>;
  readonly regionByJoin: ReadonlyMap<string, CompiledPipeline['forkRegions'][number]>;
  readonly regionOwnerByNode: ReadonlyMap<string, string>;
  readonly resolutionsByNode: ReadonlyMap<string, ReadonlySet<string>>;
  readonly topologicalPosition: ReadonlyMap<string, number>;
}
