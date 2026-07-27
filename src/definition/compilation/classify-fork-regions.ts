import type { DefinitionFaultCode } from '../../errors/index.js';
import type { CompiledEdge, CompiledForkRegion, PipelineNode } from '../../spec/index.js';
import type { CompilerSemanticGraph } from '../contracts/compiler-semantic-graph.js';
import type { DefinitionValidationResult } from '../contracts/definition-validation-result.js';
import type { preflightForkRegions } from './preflight-fork-regions.js';

type MutableFault = { code: DefinitionFaultCode; path: string; message: string };
type MutableEdge = { -readonly [Key in keyof CompiledEdge]: CompiledEdge[Key] };
type ForkNode = Extract<PipelineNode, { readonly kind: 'fork' }>;
type JoinNode = Extract<PipelineNode, { readonly kind: 'join' }>;
type Preflight = ReturnType<typeof preflightForkRegions>;
type BranchPreflight = Preflight['forks'][number]['branches'][number];
type ClassificationInput = {
  readonly graph: CompilerSemanticGraph;
  readonly nodes: readonly PipelineNode[];
  readonly preflight: Preflight;
  readonly sourceIndexes: ReadonlyMap<string, number>;
  readonly faults: DefinitionValidationResult['faults'];
};

const semanticEdge = (offset: number, graph: CompilerSemanticGraph): MutableEdge | undefined => {
  const semanticOffset = graph.inducedSemanticOffsets[offset];
  return semanticOffset === undefined ? undefined : graph.edges[semanticOffset];
};

const edgeIsPermitted = (
  edge: CompiledEdge,
  fork: ForkNode,
  join: JoinNode,
  owners: ReadonlyMap<string, string>,
  exits: ReadonlyMap<string, string>,
): boolean => {
  const fromOwner = owners.get(edge.from);
  const toOwner = owners.get(edge.to);
  const permittedExit =
    fromOwner !== undefined && edge.from === exits.get(fromOwner) && edge.to === join.key;
  const permittedEntry = edge.from === fork.key && toOwner !== undefined;
  const permittedInternal = fromOwner !== undefined && fromOwner === toOwner;
  const directBarrier = edge.from === fork.key && edge.to === join.key;
  return (
    (fromOwner === undefined && toOwner === undefined) ||
    permittedExit ||
    permittedEntry ||
    permittedInternal ||
    directBarrier
  );
};

const validateRegionEdges = (
  fork: ForkNode,
  join: JoinNode,
  owners: ReadonlyMap<string, string>,
  exits: ReadonlyMap<string, string>,
  graph: CompilerSemanticGraph,
  sourceIndexes: ReadonlyMap<string, number>,
  faults: MutableFault[],
): void => {
  const forkOffset = graph.kernel.nodeOffset(fork.key);
  const offsets = new Set(
    forkOffset === undefined ? [] : graph.kernel.outgoingEdgeOffsets[forkOffset],
  );
  for (const member of owners.keys()) {
    const offset = graph.kernel.nodeOffset(member);
    if (offset === undefined) {
      continue;
    }
    for (const edgeOffset of graph.kernel.outgoingEdgeOffsets[offset] ?? []) {
      offsets.add(edgeOffset);
    }
    for (const edgeOffset of graph.kernel.incomingEdgeOffsets[offset] ?? []) {
      offsets.add(edgeOffset);
    }
  }
  for (const offset of offsets) {
    const edge = semanticEdge(offset, graph);
    if (edge && !edgeIsPermitted(edge, fork, join, owners, exits)) {
      faults.push({
        code: 'DEF_FORK_REGION',
        path: `/nodes/${sourceIndexes.get(edge.from) ?? 0}`,
        message: 'Invalid fork-region edge.',
      });
    }
  }
};

const classifyBranchReadiness = (
  fork: Preflight['forks'][number],
  branch: BranchPreflight,
  members: readonly string[],
  graph: CompilerSemanticGraph,
  nodeByKey: ReadonlyMap<string, PipelineNode>,
  sourceIndexes: ReadonlyMap<string, number>,
  faults: MutableFault[],
): void => {
  const exit = nodeByKey.get(branch.branch.exit);
  if (exit?.kind !== 'task' || !members.includes(branch.branch.exit)) {
    faults.push({
      code: 'DEF_FORK_REGION',
      path: `${branch.branchPath}/exit`,
      message: 'Branch exit must be a member task.',
    });
  }
  const offset = graph.kernel.nodeOffset(branch.branch.exit);
  const exitEdges = (offset === undefined ? [] : (graph.kernel.outgoingEdgeOffsets[offset] ?? []))
    .map((edgeOffset) => semanticEdge(edgeOffset, graph))
    .filter((edge): edge is MutableEdge => edge !== undefined);
  if (exitEdges.length !== 4 || exitEdges.some((edge) => edge.to !== fork.join.key)) {
    faults.push({
      code: 'DEF_FORK_REGION',
      path: `/nodes/${sourceIndexes.get(branch.branch.exit) ?? 0}`,
      message: 'Every exit outcome must target the join.',
    });
  }
  for (const edge of exitEdges) {
    edge.role = 'readiness';
    edge.fork = fork.fork.key;
    edge.branch = branch.branch.name;
  }
};

const validateJoinIngress = (
  join: JoinNode,
  nodeByKey: ReadonlyMap<string, PipelineNode>,
  graph: CompilerSemanticGraph,
  sourceIndexes: ReadonlyMap<string, number>,
  faults: MutableFault[],
): void => {
  const fork = nodeByKey.get(join.fork);
  const exits = fork?.kind === 'fork' ? fork.branches.map((branch) => branch.exit) : [];
  const offset = graph.kernel.nodeOffset(join.key);
  for (const edgeOffset of offset === undefined
    ? []
    : (graph.kernel.incomingEdgeOffsets[offset] ?? [])) {
    const edge = semanticEdge(edgeOffset, graph);
    if (!edge) {
      continue;
    }
    const activation =
      edge.from === join.fork && edge.role === 'activation' && edge.outcome === 'forked';
    const readiness =
      exits.includes(edge.from) && edge.role === 'readiness' && edge.fork === join.fork;
    if (!activation && !readiness) {
      faults.push({
        code: 'DEF_FORK_REGION',
        path: `/nodes/${sourceIndexes.get(edge.from) ?? 0}`,
        message: 'Invalid join ingress.',
      });
    }
  }
};

export const classifyForkRegions = ({
  graph,
  nodes,
  preflight,
  sourceIndexes,
  faults,
}: ClassificationInput): readonly CompiledForkRegion[] => {
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const regions: CompiledForkRegion[] = [];
  for (const fork of preflight.forks) {
    const result = fork.queryIndex === undefined ? undefined : graph.ownership[fork.queryIndex];
    const owners = new Map<string, string>();
    const exits = new Map<string, string>();
    const branches = fork.branches.map((branch, branchOffset) => {
      const members = (result?.membersByBranch[branchOffset] ?? [])
        .map((offset) => graph.kernel.nodeKeys[offset] ?? '')
        .filter((key) => key !== '');
      exits.set(branch.branch.name, branch.branch.exit);
      for (const member of members) {
        const owner = owners.get(member);
        if (owner !== undefined && owner !== branch.branch.name) {
          faults.push({
            code: 'DEF_FORK_REGION',
            path: branch.branchPath,
            message: 'Fork branches overlap.',
          });
        }
        owners.set(member, branch.branch.name);
        const kind = nodeByKey.get(member)?.kind;
        if (kind === 'fork' || kind === 'join') {
          faults.push({
            code: kind === 'fork' ? 'DEF_FORK_NESTED' : 'DEF_FORK_REGION',
            path: `/nodes/${sourceIndexes.get(member) ?? 0}`,
            message:
              kind === 'fork' ? 'Nested forks are forbidden.' : 'Foreign join in fork region.',
          });
        }
      }
      classifyBranchReadiness(fork, branch, members, graph, nodeByKey, sourceIndexes, faults);
      return { ...branch.branch, members };
    });
    validateRegionEdges(fork.fork, fork.join, owners, exits, graph, sourceIndexes, faults);
    regions.push({ fork: fork.fork.key, join: fork.join.key, branches });
  }
  for (const join of nodes.filter((node): node is JoinNode => node.kind === 'join')) {
    validateJoinIngress(join, nodeByKey, graph, sourceIndexes, faults);
  }
  const identical =
    graph.edges.length === graph.inducedEdges.length &&
    graph.edges.every(
      (edge, offset) =>
        graph.inducedSemanticOffsets[offset] === offset &&
        graph.inducedEdges[offset]?.from === edge.from &&
        graph.inducedEdges[offset]?.outcome === edge.outcome &&
        graph.inducedEdges[offset]?.to === edge.to,
    );
  if (faults.length === 0 && !identical) {
    faults.push({ code: 'DEF_TYPE', path: '/nodes', message: 'Invalid graph topology.' });
  }
  return regions;
};
