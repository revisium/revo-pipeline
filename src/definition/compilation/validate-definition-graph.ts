import type { DefinitionFaultCode } from '../../errors/index.js';
import {
  buildGraphKernel,
  collectBarrierRegionOwnership,
  reachableNodeOffsets,
  reverseReachableNodeOffsets,
  topologicalOrder,
} from '../../graph/index.js';
import { PIPELINE_LIMITS } from '../../policy/index.js';
import type { CompiledEdge, PipelineNode } from '../../spec/index.js';
import type { CompilerSemanticGraph } from '../contracts/compiler-semantic-graph.js';
import type { DefinitionValidationResult } from '../contracts/definition-validation-result.js';
import type { preflightForkRegions } from './preflight-fork-regions.js';

type MutableFault = { code: DefinitionFaultCode; path: string; message: string };
type MutableCompiledEdge = { -readonly [Key in keyof CompiledEdge]: CompiledEdge[Key] };
type GraphInput = {
  readonly edges: readonly CompiledEdge[];
  readonly entry: string;
  readonly faults: DefinitionValidationResult['faults'];
  readonly nodes: readonly PipelineNode[];
  readonly preflight: ReturnType<typeof preflightForkRegions>;
  readonly sourceIndexes: ReadonlyMap<string, number>;
};

const validateReferences = (
  entry: string,
  nodes: readonly PipelineNode[],
  edges: readonly CompiledEdge[],
  sourceIndexes: ReadonlyMap<string, number>,
  faults: MutableFault[],
): void => {
  const keys = new Set(nodes.map((node) => node.key));
  if (!keys.has(entry)) {
    faults.push({ code: 'DEF_ENTRY', path: '/entry', message: 'Entry must reference a node.' });
  }
  for (const edge of edges) {
    if (!keys.has(edge.to)) {
      faults.push({
        code: 'DEF_TARGET',
        path: `/nodes/${sourceIndexes.get(edge.from) ?? 0}`,
        message: `Unknown target ${edge.to}.`,
      });
    }
  }
  if (edges.length > PIPELINE_LIMITS.definition.edges) {
    faults.push({ code: 'DEF_LIMIT', path: '/nodes', message: 'Edge limit exceeded.' });
  }
};

const addDagFaults = (
  entry: string,
  nodes: readonly PipelineNode[],
  graphOrder: readonly number[] | null,
  kernel: CompilerSemanticGraph['kernel'],
  sourceIndexes: ReadonlyMap<string, number>,
  faults: MutableFault[],
): readonly string[] => {
  if (graphOrder === null) {
    faults.push({ code: 'DEF_CYCLE', path: '/nodes', message: 'Pipeline graph contains a cycle.' });
  }
  const entryOffset = kernel.nodeOffset(entry);
  const reachable = reachableNodeOffsets(kernel, entryOffset === undefined ? [] : [entryOffset]);
  const terminalOffsets = nodes
    .filter((node) => node.kind === 'terminal')
    .map((node) => kernel.nodeOffset(node.key))
    .filter((offset): offset is number => offset !== undefined);
  const leading = reverseReachableNodeOffsets(kernel, terminalOffsets);
  for (const node of nodes) {
    const offset = kernel.nodeOffset(node.key);
    const path = `/nodes/${sourceIndexes.get(node.key) ?? 0}`;
    if (offset === undefined || !reachable[offset]) {
      faults.push({ code: 'DEF_UNREACHABLE', path, message: 'Node is unreachable.' });
    }
    if (offset === undefined || !leading[offset]) {
      faults.push({ code: 'DEF_DEAD_END', path, message: 'Node cannot reach a terminal.' });
    }
  }
  return (graphOrder ?? []).map((offset) => kernel.nodeKeys[offset] ?? '');
};

export const validateDefinitionGraph = ({
  edges: projectedEdges,
  entry,
  faults,
  nodes,
  preflight,
  sourceIndexes,
}: GraphInput): CompilerSemanticGraph | null => {
  validateReferences(entry, nodes, projectedEdges, sourceIndexes, faults);
  const edges: MutableCompiledEdge[] = projectedEdges.map((edge) => ({ ...edge }));
  const nodeKeys = nodes.map((node) => node.key);
  const knownKeys = new Set(nodeKeys);
  const induced = edges.flatMap((edge, semanticOffset) =>
    knownKeys.has(edge.from) && knownKeys.has(edge.to)
      ? [
          {
            edge: Object.freeze({ from: edge.from, outcome: edge.outcome, to: edge.to }),
            semanticOffset,
          },
        ]
      : [],
  );
  const inducedEdges = Object.freeze(induced.map(({ edge }) => edge));
  const inducedSemanticOffsets = Object.freeze(induced.map(({ semanticOffset }) => semanticOffset));
  if (
    nodeKeys.length > PIPELINE_LIMITS.definition.nodes ||
    inducedEdges.length > PIPELINE_LIMITS.definition.edges
  ) {
    return null;
  }
  const kernelBuild = buildGraphKernel({ nodeKeys, edges: inducedEdges });
  if (!kernelBuild.ok) {
    faults.push({ code: 'DEF_TYPE', path: '/nodes', message: 'Invalid graph topology.' });
    return null;
  }
  const kernel = kernelBuild.kernel;
  const graphOrder = topologicalOrder(kernel);
  const ownership = collectBarrierRegionOwnership(kernel, graphOrder, preflight.queries);
  const compiledOrder = addDagFaults(entry, nodes, graphOrder, kernel, sourceIndexes, faults);
  return {
    edges,
    inducedEdges,
    inducedSemanticOffsets,
    kernel,
    ownership,
    topologicalOrder: compiledOrder,
  };
};
