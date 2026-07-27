import type { BarrierRegionOwnership, GraphKernel } from '../../graph/index.js';
import type { CompiledEdge, NodeKey } from '../../spec/index.js';

type MutableCompiledEdge = { -readonly [Key in keyof CompiledEdge]: CompiledEdge[Key] };

export type CompilerSemanticGraph = {
  readonly edges: readonly MutableCompiledEdge[];
  readonly inducedEdges: readonly {
    readonly from: NodeKey;
    readonly outcome: string;
    readonly to: NodeKey;
  }[];
  readonly inducedSemanticOffsets: readonly number[];
  readonly kernel: GraphKernel;
  readonly ownership: readonly BarrierRegionOwnership[];
  readonly topologicalOrder: readonly NodeKey[];
};
