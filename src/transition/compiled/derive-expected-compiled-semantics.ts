import { compareUnicodeCodePoints } from '../../policy/index.js';
import type { CompiledEdge, CompiledForkBranch } from '../../spec/index.js';
import type { CompiledForkRegion, PipelineNode } from '../../spec/index.js';
import type { ExpectedCompiledSemantics } from './expected-compiled-semantics.js';

type ForkNode = Extract<PipelineNode, { readonly kind: 'fork' }>;
type MemberOwner = {
  readonly branch: string;
  readonly entry: string;
  readonly exit: string;
  readonly fork: string;
  readonly join: string;
};

type RegionDerivationState = {
  readonly memberOwner: Map<string, MemberOwner>;
  readonly joinOwner: Map<string, string>;
  readonly internalIncoming: Map<string, number>;
  readonly internalOutgoing: Map<string, number>;
};

const edgeFor = (from: string, outcome: string, to: string): CompiledEdge => ({
  from,
  outcome,
  to,
  role: 'activation',
  fork: null,
  branch: null,
});

const edgeComparator = (left: CompiledEdge, right: CompiledEdge): number =>
  compareUnicodeCodePoints(left.from, right.from) ||
  compareUnicodeCodePoints(left.outcome, right.outcome) ||
  compareUnicodeCodePoints(left.to, right.to) ||
  compareUnicodeCodePoints(left.role, right.role) ||
  compareUnicodeCodePoints(left.fork ?? '', right.fork ?? '') ||
  compareUnicodeCodePoints(left.branch ?? '', right.branch ?? '');

const expectedEdgesForNode = (node: PipelineNode): readonly CompiledEdge[] | undefined => {
  if (node.kind === 'task' || node.kind === 'join' || node.kind === 'consensus') {
    return Object.entries(node.outcomes).map(([outcome, to]) => edgeFor(node.key, outcome, to));
  }
  if (node.kind === 'fork') {
    return [
      ...node.branches.map((branch) => ({
        ...edgeFor(node.key, 'forked', branch.entry),
        fork: node.key,
        branch: branch.name,
      })),
      { ...edgeFor(node.key, 'forked', node.join), fork: node.key },
    ];
  }
  if (node.kind === 'humanGate') {
    return node.resolutions.map((route) => edgeFor(node.key, route.resolution, route.to));
  }
  if (node.kind === 'branch') {
    return [
      ...node.cases.map((entry) => edgeFor(node.key, entry.name, entry.to)),
      ...(node.default ? [edgeFor(node.key, node.default.name, node.default.to)] : []),
    ];
  }
  return node.kind === 'terminal' ? [] : undefined;
};

const traverse = (
  start: string,
  barrier: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
): ReadonlySet<string> => {
  const reached = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const key = pending.pop();
    if (key === undefined || key === barrier || reached.has(key)) {
      continue;
    }
    reached.add(key);
    pending.push(...(adjacency.get(key) ?? []));
  }
  return reached;
};

const deriveRegionMembers = (
  entry: string,
  exit: string,
  barrier: string,
  edges: readonly CompiledEdge[],
): readonly string[] => {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }
  const forward = traverse(entry, barrier, outgoing);
  const reverse = traverse(exit, barrier, incoming);
  return [...forward].filter((member) => reverse.has(member)).sort(compareUnicodeCodePoints);
};

const claimRegionMembers = (
  members: readonly string[],
  branch: ForkNode['branches'][number],
  fork: ForkNode,
  nodeByKey: ReadonlyMap<string, PipelineNode>,
  state: RegionDerivationState,
): boolean => {
  for (const member of members) {
    const memberNode = nodeByKey.get(member);
    const memberIsInvalid =
      state.memberOwner.has(member) ||
      !memberNode ||
      memberNode.kind === 'fork' ||
      memberNode.kind === 'join';
    if (memberIsInvalid) {
      return false;
    }
    state.memberOwner.set(member, {
      branch: branch.name,
      entry: branch.entry,
      exit: branch.exit,
      fork: fork.key,
      join: fork.join,
    });
  }
  return true;
};

const deriveRegion = (
  fork: ForkNode,
  nodeByKey: ReadonlyMap<string, PipelineNode>,
  edges: readonly CompiledEdge[],
  state: RegionDerivationState,
): CompiledForkRegion | undefined => {
  const join = nodeByKey.get(fork.join);
  if (
    join?.kind !== 'join' ||
    join.fork !== fork.key ||
    state.joinOwner.has(join.key) ||
    (join.policy.kind === 'threshold' &&
      (join.policy.count < 1 || join.policy.count > fork.branches.length))
  ) {
    return undefined;
  }
  state.joinOwner.set(join.key, fork.key);
  const branches: CompiledForkBranch[] = [];
  for (const branch of fork.branches) {
    const members = deriveRegionMembers(branch.entry, branch.exit, join.key, edges);
    if (
      !members.includes(branch.entry) ||
      !members.includes(branch.exit) ||
      nodeByKey.get(branch.exit)?.kind !== 'task' ||
      !claimRegionMembers(members, branch, fork, nodeByKey, state)
    ) {
      return undefined;
    }
    branches.push({ ...branch, members });
  }
  return { fork: fork.key, join: fork.join, branches };
};

const validateExpectedEdges = (
  edges: readonly CompiledEdge[],
  state: RegionDerivationState,
): boolean => {
  for (const edge of edges) {
    const fromOwner = state.memberOwner.get(edge.from);
    const toOwner = state.memberOwner.get(edge.to);
    const targetJoinFork = state.joinOwner.get(edge.to);
    if (fromOwner && toOwner) {
      if (fromOwner.fork !== toOwner.fork || fromOwner.branch !== toOwner.branch) {
        return false;
      }
      state.internalOutgoing.set(edge.from, (state.internalOutgoing.get(edge.from) ?? 0) + 1);
      state.internalIncoming.set(edge.to, (state.internalIncoming.get(edge.to) ?? 0) + 1);
      continue;
    }
    if (fromOwner) {
      if (edge.from !== fromOwner.exit || edge.to !== fromOwner.join) {
        return false;
      }
      Reflect.set(edge, 'role', 'readiness');
      Reflect.set(edge, 'fork', fromOwner.fork);
      Reflect.set(edge, 'branch', fromOwner.branch);
      continue;
    }
    if (toOwner) {
      if (edge.from !== toOwner.fork || edge.to !== toOwner.entry) {
        return false;
      }
      continue;
    }
    if (targetJoinFork !== undefined && edge.from !== targetJoinFork) {
      return false;
    }
  }
  return true;
};

const membersAreContinuous = (state: RegionDerivationState): boolean =>
  [...state.memberOwner].every(
    ([member, owner]) =>
      (member === owner.entry || state.internalIncoming.has(member)) &&
      (member === owner.exit || state.internalOutgoing.has(member)),
  );

const deriveRegions = (
  nodes: readonly PipelineNode[],
  edges: readonly CompiledEdge[],
): readonly CompiledForkRegion[] | undefined => {
  const state: RegionDerivationState = {
    memberOwner: new Map(),
    joinOwner: new Map(),
    internalIncoming: new Map(),
    internalOutgoing: new Map(),
  };
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const regions: CompiledForkRegion[] = [];
  for (const node of nodes) {
    if (node.kind !== 'fork') {
      continue;
    }
    const region = deriveRegion(node, nodeByKey, edges, state);
    if (region === undefined) {
      return undefined;
    }
    regions.push(region);
  }
  return validateExpectedEdges(edges, state) && membersAreContinuous(state) ? regions : undefined;
};

export const deriveExpectedCompiledSemantics = (
  nodes: readonly PipelineNode[],
): ExpectedCompiledSemantics | undefined => {
  const edges: CompiledEdge[] = [];
  for (const node of nodes) {
    const nodeEdges = expectedEdgesForNode(node);
    if (nodeEdges === undefined) {
      return undefined;
    }
    edges.push(...nodeEdges);
  }
  const regions = deriveRegions(nodes, edges);
  if (regions === undefined) {
    return undefined;
  }
  edges.sort(edgeComparator);
  return { nodeKeys: nodes.map((node) => node.key), edges, regions };
};
