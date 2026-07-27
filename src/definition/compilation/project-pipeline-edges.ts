import { compareUnicodeCodePoints } from '../../policy/index.js';
import type { CompiledEdge, PipelineNode } from '../../spec/index.js';
import type { CompilerSemanticGraph } from '../contracts/compiler-semantic-graph.js';

const edgesForNode = (node: PipelineNode): CompiledEdge[] => {
  const edge = (outcome: string, to: string): CompiledEdge => ({
    from: node.key,
    outcome,
    to,
    role: 'activation',
    fork: null,
    branch: null,
  });
  switch (node.kind) {
    case 'task':
    case 'join':
    case 'consensus':
      return Object.entries(node.outcomes).map(([outcome, to]) => edge(outcome, to));
    case 'branch':
      return [
        ...node.cases.map((entry) => edge(entry.name, entry.to)),
        ...(node.default ? [edge(node.default.name, node.default.to)] : []),
      ];
    case 'fork':
      return [
        ...node.branches.map((branch) => ({
          ...edge('forked', branch.entry),
          fork: node.key,
          branch: branch.name,
        })),
        { ...edge('forked', node.join), fork: node.key },
      ];
    case 'humanGate':
      return node.resolutions.map((entry) => edge(entry.resolution, entry.to));
    case 'terminal':
      return [];
  }
  throw new Error('Unsupported pipeline node.');
};

const edgeComparator = (left: CompiledEdge, right: CompiledEdge): number =>
  compareUnicodeCodePoints(left.from, right.from) ||
  compareUnicodeCodePoints(left.outcome, right.outcome) ||
  compareUnicodeCodePoints(left.to, right.to) ||
  compareUnicodeCodePoints(left.role, right.role) ||
  compareUnicodeCodePoints(left.fork ?? '', right.fork ?? '') ||
  compareUnicodeCodePoints(left.branch ?? '', right.branch ?? '');

export const projectPipelineEdges = (
  nodes: readonly PipelineNode[],
): Pick<CompilerSemanticGraph, 'edges'> => ({
  edges: nodes.flatMap(edgesForNode).sort(edgeComparator),
});
