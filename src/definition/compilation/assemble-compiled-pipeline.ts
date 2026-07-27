import type { PipelineCompilation } from '../../errors/index.js';
import { compareUnicodeCodePoints } from '../../policy/index.js';
import type {
  CompiledForkRegion,
  CompiledPipeline,
  FactDefinition,
  PipelineNode,
} from '../../spec/index.js';
import type { CompilerSemanticGraph } from '../contracts/compiler-semantic-graph.js';

type AssemblyInput = {
  readonly entry: string;
  readonly facts: readonly FactDefinition[];
  readonly graph: CompilerSemanticGraph;
  readonly nodes: readonly PipelineNode[];
  readonly regions: readonly CompiledForkRegion[];
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) {
      deepFreeze(descriptor.value);
    }
  }
  return Object.freeze(value);
};

const buildIndexes = (
  nodes: readonly PipelineNode[],
  graph: CompilerSemanticGraph,
): Pick<CompiledPipeline, 'incomingIndex' | 'nodeIndex' | 'outgoingIndex'> => ({
  nodeIndex: nodes.map((node, index) => ({ key: node.key, node: index })),
  outgoingIndex: nodes.map((node, offset) => ({
    key: node.key,
    edges: graph.kernel.outgoingEdgeOffsets[offset] ?? [],
  })),
  incomingIndex: nodes.map((node, offset) => ({
    key: node.key,
    edges: graph.kernel.incomingEdgeOffsets[offset] ?? [],
  })),
});

export const assembleCompiledPipeline = ({
  entry,
  facts,
  graph,
  nodes,
  regions,
}: AssemblyInput): PipelineCompilation => {
  const sortedFacts = [...facts].sort((left, right) =>
    compareUnicodeCodePoints(left.key, right.key),
  );
  const forkRegions = [...regions]
    .map((region) => ({
      ...region,
      branches: [...region.branches].sort((left, right) =>
        compareUnicodeCodePoints(left.name, right.name),
      ),
    }))
    .sort((left, right) => compareUnicodeCodePoints(left.fork, right.fork));
  return {
    ok: true,
    pipeline: deepFreeze({
      schemaVersion: 1,
      entry,
      facts: sortedFacts,
      nodes,
      edges: graph.edges,
      topologicalOrder: graph.topologicalOrder,
      forkRegions,
      ...buildIndexes(nodes, graph),
    }),
  };
};
