import type { DecisionFault, DecisionFaultCode, PipelineDecision } from '../errors/index.js';
import type { GraphKernel } from '../graph/index.js';
import {
  compareUnicodeCodePoints,
  DECISION_FAULT_PHASES,
  inspectPortableValueSet,
  isValidKey,
  isValidSemanticName,
  jsonScalarsEqual,
  orderFaults,
  PIPELINE_LIMITS,
} from '../policy/index.js';
import type {
  BranchNode,
  CandidateVerdict,
  CompiledPipeline,
  GateResolution,
  JsonScalar,
  NodeFact,
  PipelineFacts,
  PipelineNode,
  PipelineValueFact,
} from '../spec/index.js';
import { validateCompiledInternally } from './validate-compiled-internally.js';

type MutableFault = { code: DecisionFaultCode; path: string; message: string };
type IndexedFact<T> = { readonly fact: T; readonly sourceIndex: number };
type ConsensusFacts = {
  readonly approvals: number;
  readonly rejections: number;
  readonly total: number;
};
type ValidatedFacts = {
  readonly candidateVerdicts: readonly IndexedFact<CandidateVerdict>[];
  readonly consensusByNode: ReadonlyMap<string, ConsensusFacts>;
  readonly gateResolutions: readonly IndexedFact<GateResolution>[];
  readonly gateResolutionByNode: ReadonlyMap<string, GateResolution>;
  readonly nodes: readonly IndexedFact<NodeFact>[];
  readonly nodeByKey: ReadonlyMap<string, NodeFact>;
  readonly values: readonly PipelineValueFact[];
  readonly valueByKey: ReadonlyMap<string, JsonScalar>;
};

const FACT_FIELDS = ['candidateVerdicts', 'gateResolutions', 'nodes', 'values'] as const;
const INVALID_PORTABLE_ENTRY = Symbol('invalid-portable-entry');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const keys = Object.keys(value).sort(compareUnicodeCodePoints);
  const expected = [...fields].sort(compareUnicodeCodePoints);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

const addFault = (
  faults: MutableFault[],
  code: DecisionFaultCode,
  path: string,
  message: string,
): void => {
  faults.push({ code, path, message });
};

const isDecisionFaultCode = (value: string): value is DecisionFaultCode =>
  DECISION_FAULT_PHASES.some((phase) =>
    (phase.codes as readonly string[]).some((code) => code === value),
  );

const orderedFaults = (faults: readonly MutableFault[]): readonly DecisionFault[] =>
  orderFaults(faults, DECISION_FAULT_PHASES, 'FACT_LIMIT', 'decision').map((fault) => {
    if (!isDecisionFaultCode(fault.code)) {
      throw new Error(`Unexpected decision fault code: ${fault.code}`);
    }
    return { code: fault.code, path: fault.path, message: fault.message };
  });

const reject = (faults: readonly MutableFault[]): PipelineDecision => ({
  kind: 'reject',
  faults: orderedFaults(faults),
});

const nodeOutcomeExists = (node: PipelineNode, outcome: string): boolean => {
  if (node.kind === 'task' || node.kind === 'join' || node.kind === 'consensus') {
    return Object.hasOwn(node.outcomes, outcome);
  }
  if (node.kind === 'branch') {
    return node.cases.some((entry) => entry.name === outcome) || node.default?.name === outcome;
  }
  if (node.kind === 'fork') {
    return outcome === 'forked';
  }
  if (node.kind === 'humanGate') {
    return node.resolutions.some((route) => route.resolution === outcome);
  }
  return node.kind === 'terminal' && node.outcome === outcome;
};

const validateValueFacts = (
  input: readonly unknown[],
  pipeline: CompiledPipeline,
  faults: MutableFault[],
): readonly PipelineValueFact[] => {
  const definitions = new Map(pipeline.facts.map((fact) => [fact.key, fact]));
  const seen = new Set<string>();
  const values: PipelineValueFact[] = [];
  input.forEach((entry, index) => {
    if (entry === INVALID_PORTABLE_ENTRY) {
      return;
    }
    const path = `/values/${index}`;
    if (!isRecord(entry) || !hasExactFields(entry, ['key', 'value']) || !isValidKey(entry.key)) {
      addFault(faults, 'FACT_TYPE', path, 'Invalid value fact.');
      return;
    }
    const key = entry.key;
    const definition = definitions.get(key);
    if (seen.has(key)) {
      addFault(faults, 'FACT_DUPLICATE', `${path}/key`, 'Duplicate value fact.');
      return;
    }
    seen.add(key);
    if (!definition) {
      addFault(faults, 'FACT_FOREIGN', `${path}/key`, 'Foreign value fact.');
      return;
    }
    const value = entry.value;
    const actualType = value === null ? 'null' : typeof value;
    const validScalar =
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isSafeInteger(value));
    if (!validScalar || actualType !== definition.type) {
      addFault(faults, 'FACT_TYPE', `${path}/value`, 'Value fact type mismatch.');
      return;
    }
    values.push({ key, value });
  });
  return values;
};

const validateNodeFacts = (
  input: readonly unknown[],
  pipeline: CompiledPipeline,
  faults: MutableFault[],
): readonly IndexedFact<NodeFact>[] => {
  const nodes = new Map(pipeline.nodes.map((node) => [node.key, node]));
  const seen = new Set<string>();
  const facts: IndexedFact<NodeFact>[] = [];
  input.forEach((entry, index) => {
    if (entry === INVALID_PORTABLE_ENTRY) {
      return;
    }
    const path = `/nodes/${index}`;
    if (!isRecord(entry) || !isValidKey(entry.key)) {
      addFault(faults, 'FACT_TYPE', path, 'Invalid node fact.');
      return;
    }
    const key = entry.key;
    const node = nodes.get(key);
    if (seen.has(key)) {
      addFault(faults, 'FACT_DUPLICATE', `${path}/key`, 'Duplicate node fact.');
      return;
    }
    seen.add(key);
    if (!node) {
      addFault(faults, 'FACT_FOREIGN', `${path}/key`, 'Foreign node fact.');
      return;
    }
    if (entry.state === 'enabled') {
      if (!hasExactFields(entry, ['key', 'state'])) {
        addFault(faults, 'FACT_TYPE', path, 'Invalid enabled node fact.');
        return;
      }
      facts.push({ fact: { key, state: 'enabled' }, sourceIndex: index });
      return;
    }
    if (
      !hasExactFields(entry, ['key', 'outcome', 'state']) ||
      entry.state !== 'terminal' ||
      typeof entry.outcome !== 'string' ||
      !nodeOutcomeExists(node, entry.outcome)
    ) {
      addFault(faults, 'FACT_OUTCOME', `${path}/outcome`, 'Invalid node outcome.');
      return;
    }
    facts.push({ fact: { key, state: 'terminal', outcome: entry.outcome }, sourceIndex: index });
  });
  return facts;
};

const collection = (
  value: unknown,
  path: string,
  maximum: number,
  faults: MutableFault[],
  portableContainerInvalid = false,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    if (!portableContainerInvalid) {
      addFault(faults, 'FACT_TYPE', path, 'Expected fact array.');
    }
    return [];
  }
  if (value.length > maximum) {
    addFault(faults, 'FACT_LIMIT', path, 'Fact collection limit exceeded.');
    return [];
  }
  return value;
};

type PortableIssueIndex = {
  readonly containers: ReadonlySet<string>;
  readonly entries: ReadonlyMap<string, ReadonlySet<number>>;
};

const portableIssueIndex = (paths: readonly string[]): PortableIssueIndex => {
  const containers = new Set<string>();
  const entries = new Map<string, Set<number>>();
  for (const path of paths) {
    for (const field of FACT_FIELDS) {
      const prefix = `/${field}`;
      if (path === prefix) {
        containers.add(prefix);
        break;
      }
      if (!path.startsWith(`${prefix}/`)) {
        continue;
      }
      const segment = path.slice(prefix.length + 1).split('/', 1)[0] ?? '';
      if (/^(0|[1-9]\d*)$/.test(segment)) {
        const indexes = entries.get(prefix) ?? new Set<number>();
        indexes.add(Number(segment));
        entries.set(prefix, indexes);
      }
      break;
    }
  }
  return { containers, entries };
};

const validPortableEntries = (
  input: readonly unknown[],
  collectionPath: string,
  issues: PortableIssueIndex,
): readonly unknown[] =>
  input.map((entry, index) =>
    issues.entries.get(collectionPath)?.has(index) ? INVALID_PORTABLE_ENTRY : entry,
  );

const precheckFactArrayBounds = (input: unknown, faults: MutableFault[]): boolean => {
  if (!isRecord(input)) {
    return true;
  }
  const limits: Readonly<Record<(typeof FACT_FIELDS)[number], number>> = {
    values: PIPELINE_LIMITS.facts.values,
    nodes: PIPELINE_LIMITS.facts.nodes,
    candidateVerdicts: PIPELINE_LIMITS.facts.candidateVerdicts,
    gateResolutions: PIPELINE_LIMITS.facts.gateResolutions,
  };
  let total = 0;
  let pruned = false;
  for (const field of FACT_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor || !('value' in descriptor) || !Array.isArray(descriptor.value)) {
      continue;
    }
    const length = descriptor.value.length;
    total += length;
    if (length > limits[field]) {
      addFault(faults, 'FACT_LIMIT', `/${field}`, 'Fact collection limit exceeded.');
      pruned = true;
    }
  }
  if (total > PIPELINE_LIMITS.facts.total) {
    addFault(faults, 'FACT_LIMIT', '', 'Aggregate fact limit exceeded.');
    pruned = true;
  }
  return !pruned;
};

const validateCandidateFacts = (
  input: readonly unknown[],
  graph: EvaluationIndex,
  faults: MutableFault[],
): readonly IndexedFact<CandidateVerdict>[] => {
  const seen = new Set<string>();
  const validated: IndexedFact<CandidateVerdict>[] = [];
  input.forEach((entry, index) => {
    if (entry === INVALID_PORTABLE_ENTRY) {
      return;
    }
    const path = `/candidateVerdicts/${index}`;
    if (
      !isRecord(entry) ||
      !hasExactFields(entry, ['candidate', 'nodeKey', 'verdict']) ||
      !isValidKey(entry.nodeKey) ||
      !isValidSemanticName(entry.candidate) ||
      (entry.verdict !== 'abstain' && entry.verdict !== 'approve' && entry.verdict !== 'reject')
    ) {
      addFault(faults, 'FACT_TYPE', path, 'Invalid candidate verdict fact.');
      return;
    }
    const identity = `${entry.nodeKey}\u0000${entry.candidate}`;
    if (seen.has(identity)) {
      addFault(faults, 'FACT_DUPLICATE', path, 'Duplicate candidate verdict fact.');
      return;
    }
    seen.add(identity);
    const node = graph.nodeByKey.get(entry.nodeKey);
    if (node?.kind !== 'consensus') {
      addFault(faults, 'FACT_FOREIGN', `${path}/nodeKey`, 'Foreign verdict node.');
      return;
    }
    if (!graph.candidatesByNode.get(entry.nodeKey)?.has(entry.candidate)) {
      addFault(faults, 'FACT_CANDIDATE', `${path}/candidate`, 'Candidate is not declared.');
      return;
    }
    validated.push({
      fact: {
        nodeKey: entry.nodeKey,
        candidate: entry.candidate,
        verdict: entry.verdict,
      },
      sourceIndex: index,
    });
  });
  return validated;
};

const validateGateFacts = (
  input: readonly unknown[],
  graph: EvaluationIndex,
  faults: MutableFault[],
): readonly IndexedFact<GateResolution>[] => {
  const seen = new Set<string>();
  const validated: IndexedFact<GateResolution>[] = [];
  input.forEach((entry, index) => {
    if (entry === INVALID_PORTABLE_ENTRY) {
      return;
    }
    const path = `/gateResolutions/${index}`;
    if (
      !isRecord(entry) ||
      !hasExactFields(entry, ['nodeKey', 'resolution']) ||
      !isValidKey(entry.nodeKey) ||
      !isValidSemanticName(entry.resolution)
    ) {
      addFault(faults, 'FACT_TYPE', path, 'Invalid gate resolution fact.');
      return;
    }
    if (
      entry.resolution !== entry.resolution.normalize('NFC') ||
      Array.from(entry.resolution).length > PIPELINE_LIMITS.portable.displayCodePoints
    ) {
      addFault(faults, 'FACT_RESOLUTION', `${path}/resolution`, 'Invalid gate resolution.');
      return;
    }
    if (seen.has(entry.nodeKey)) {
      addFault(faults, 'FACT_DUPLICATE', path, 'Duplicate gate resolution fact.');
      return;
    }
    seen.add(entry.nodeKey);
    const node = graph.nodeByKey.get(entry.nodeKey);
    if (node?.kind !== 'humanGate') {
      addFault(faults, 'FACT_FOREIGN', `${path}/nodeKey`, 'Foreign gate node.');
      return;
    }
    if (!graph.resolutionsByNode.get(entry.nodeKey)?.has(entry.resolution)) {
      addFault(faults, 'FACT_RESOLUTION', `${path}/resolution`, 'Resolution is not declared.');
      return;
    }
    validated.push({
      fact: { nodeKey: entry.nodeKey, resolution: entry.resolution },
      sourceIndex: index,
    });
  });
  return validated;
};

const validateFactShape = (
  input: unknown,
  pipeline: CompiledPipeline,
  index: EvaluationIndex,
  faults: MutableFault[],
): ValidatedFacts | undefined => {
  if (!precheckFactArrayBounds(input, faults)) {
    return undefined;
  }
  const inspected = inspectPortableValueSet(input);
  inspected.issues.forEach((issue) =>
    addFault(
      faults,
      issue.code === 'limit' ? 'FACT_LIMIT' : 'FACT_TYPE',
      issue.path,
      'Invalid portable facts.',
    ),
  );
  if (!isRecord(inspected.value)) {
    if (inspected.issues.length === 0) {
      addFault(faults, 'FACT_TYPE', '', 'Invalid facts object.');
    }
    return undefined;
  }
  if (inspected.issues.some((issue) => issue.code === 'limit' && issue.path !== '')) {
    return undefined;
  }
  const value = inspected.value;
  const issues = portableIssueIndex(inspected.issues.map((issue) => issue.path));
  const keys = Object.keys(value);
  const keySet = new Set(keys);
  if (keys.length !== FACT_FIELDS.length || FACT_FIELDS.some((key) => !keySet.has(key))) {
    addFault(faults, 'FACT_TYPE', '', 'Invalid facts object.');
  }
  const values = validPortableEntries(
    collection(
      value.values,
      '/values',
      PIPELINE_LIMITS.facts.values,
      faults,
      issues.containers.has('/values'),
    ),
    '/values',
    issues,
  );
  const nodes = validPortableEntries(
    collection(
      value.nodes,
      '/nodes',
      PIPELINE_LIMITS.facts.nodes,
      faults,
      issues.containers.has('/nodes'),
    ),
    '/nodes',
    issues,
  );
  const verdicts = validPortableEntries(
    collection(
      value.candidateVerdicts,
      '/candidateVerdicts',
      PIPELINE_LIMITS.facts.candidateVerdicts,
      faults,
      issues.containers.has('/candidateVerdicts'),
    ),
    '/candidateVerdicts',
    issues,
  );
  const resolutions = validPortableEntries(
    collection(
      value.gateResolutions,
      '/gateResolutions',
      PIPELINE_LIMITS.facts.gateResolutions,
      faults,
      issues.containers.has('/gateResolutions'),
    ),
    '/gateResolutions',
    issues,
  );
  if (
    values.length + nodes.length + verdicts.length + resolutions.length >
    PIPELINE_LIMITS.facts.total
  ) {
    addFault(faults, 'FACT_LIMIT', '', 'Aggregate fact limit exceeded.');
  }
  const candidateVerdicts = validateCandidateFacts(verdicts, index, faults);
  const gateResolutions = validateGateFacts(resolutions, index, faults);
  const validatedNodes = validateNodeFacts(nodes, pipeline, faults);
  const validatedValues = validateValueFacts(values, pipeline, faults);
  const consensusByNode = new Map<
    string,
    { approvals: number; rejections: number; total: number }
  >();
  for (const { fact } of candidateVerdicts) {
    const aggregate = consensusByNode.get(fact.nodeKey) ?? {
      approvals: 0,
      rejections: 0,
      total: 0,
    };
    aggregate.total += 1;
    aggregate.approvals += fact.verdict === 'approve' ? 1 : 0;
    aggregate.rejections += fact.verdict === 'reject' ? 1 : 0;
    consensusByNode.set(fact.nodeKey, aggregate);
  }
  return {
    candidateVerdicts,
    consensusByNode,
    gateResolutions,
    gateResolutionByNode: new Map(gateResolutions.map(({ fact }) => [fact.nodeKey, fact])),
    values: validatedValues,
    valueByKey: new Map(validatedValues.map((fact) => [fact.key, fact.value])),
    nodes: validatedNodes,
    nodeByKey: new Map(validatedNodes.map(({ fact }) => [fact.key, fact])),
  };
};

type EvaluationIndex = {
  readonly candidatesByNode: ReadonlyMap<string, ReadonlySet<string>>;
  readonly nodeByKey: ReadonlyMap<string, PipelineNode>;
  readonly incomingByKey: ReadonlyMap<string, readonly number[]>;
  readonly outgoingByKey: ReadonlyMap<string, readonly number[]>;
  readonly regionByFork: ReadonlyMap<string, CompiledPipeline['forkRegions'][number]>;
  readonly regionByJoin: ReadonlyMap<string, CompiledPipeline['forkRegions'][number]>;
  readonly regionOwnerByNode: ReadonlyMap<string, string>;
  readonly resolutionsByNode: ReadonlyMap<string, ReadonlySet<string>>;
  readonly topologicalPosition: ReadonlyMap<string, number>;
};

const evaluationIndex = (
  pipeline: CompiledPipeline,
  kernel: GraphKernel,
  topologicalOffsets: readonly number[],
): EvaluationIndex => {
  const regionOwnerByNode = new Map<string, string>();
  pipeline.forkRegions.forEach((region) => {
    region.branches.forEach((branch) => {
      branch.members.forEach((member) => regionOwnerByNode.set(member, region.fork));
    });
    regionOwnerByNode.set(region.join, region.fork);
  });
  return {
    nodeByKey: new Map(pipeline.nodes.map((node) => [node.key, node])),
    candidatesByNode: new Map(
      pipeline.nodes.flatMap((node) =>
        node.kind === 'consensus' ? [[node.key, new Set(node.candidates)] as const] : [],
      ),
    ),
    incomingByKey: new Map(
      pipeline.nodes.map((node, offset) => [node.key, kernel.incomingEdgeOffsets[offset] ?? []]),
    ),
    outgoingByKey: new Map(
      pipeline.nodes.map((node, offset) => [node.key, kernel.outgoingEdgeOffsets[offset] ?? []]),
    ),
    regionByFork: new Map(pipeline.forkRegions.map((region) => [region.fork, region])),
    regionByJoin: new Map(pipeline.forkRegions.map((region) => [region.join, region])),
    regionOwnerByNode,
    resolutionsByNode: new Map(
      pipeline.nodes.flatMap((node) =>
        node.kind === 'humanGate'
          ? [[node.key, new Set(node.resolutions.map((route) => route.resolution))] as const]
          : [],
      ),
    ),
    topologicalPosition: new Map(
      topologicalOffsets.flatMap((offset, position) => {
        const key = kernel.nodeKeys[offset];
        return key === undefined ? [] : [[key, position] as const];
      }),
    ),
  };
};

type Selection = { readonly outcome: string; readonly targets: readonly string[] };
type JoinOutcome = 'completed' | 'insufficient' | 'rejected';
type ConsensusOutcome = 'approved' | 'insufficient' | 'rejected' | 'tied';

const selectJoinOutcome = (
  policy: Extract<PipelineNode, { readonly kind: 'join' }>['policy'],
  accepted: number,
  pending: number,
  rejected: boolean,
): JoinOutcome | undefined => {
  if (policy.kind === 'all') {
    if (rejected) {
      return 'rejected';
    }
    if (pending > 0) {
      return undefined;
    }
    return accepted > 0 ? 'completed' : 'insufficient';
  }
  if (policy.kind === 'any') {
    if (accepted > 0) {
      return 'completed';
    }
    if (pending > 0) {
      return undefined;
    }
    return rejected ? 'rejected' : 'insufficient';
  }
  if (accepted >= policy.count) {
    return 'completed';
  }
  if (accepted + pending >= policy.count) {
    return undefined;
  }
  return rejected ? 'rejected' : 'insufficient';
};

const selectConsensusOutcome = (
  node: Extract<PipelineNode, { readonly kind: 'consensus' }>,
  approvals: number,
  rejections: number,
  remaining: number,
): ConsensusOutcome | undefined => {
  if (node.policy.kind === 'unanimous') {
    if (rejections > 0) {
      return 'rejected';
    }
    if (remaining > 0) {
      return undefined;
    }
    return approvals === node.candidates.length ? 'approved' : 'insufficient';
  }
  if (node.policy.kind === 'quorum') {
    if (remaining > 0) {
      return undefined;
    }
    const votes = approvals + rejections;
    if (votes < node.policy.quorum) {
      return 'insufficient';
    }
    if (approvals > rejections) {
      return 'approved';
    }
    return rejections > approvals ? 'rejected' : 'tied';
  }
  if (approvals >= node.policy.approve) {
    return 'approved';
  }
  if (rejections >= node.policy.reject) {
    return 'rejected';
  }
  if (approvals + remaining < node.policy.approve && rejections + remaining < node.policy.reject) {
    return 'insufficient';
  }
  return undefined;
};

const joinSelection = (
  node: Extract<PipelineNode, { readonly kind: 'join' }>,
  facts: ValidatedFacts,
  index: EvaluationIndex,
): Selection | undefined => {
  const region = index.regionByJoin.get(node.key);
  if (!region) {
    return undefined;
  }
  const byNode = facts.nodeByKey;
  const statuses = region.branches.map((branch) => {
    const fact = byNode.get(branch.exit);
    if (fact?.state !== 'terminal') {
      return 'pending' as const;
    }
    if (fact.outcome === 'completed') {
      return 'accepted' as const;
    }
    return fact.outcome === 'skipped' ? ('skipped' as const) : ('rejected' as const);
  });
  const accepted = statuses.filter((status) => status === 'accepted').length;
  const pending = statuses.filter((status) => status === 'pending').length;
  const rejected = statuses.some((status) => status === 'rejected');
  const outcome = selectJoinOutcome(node.policy, accepted, pending, rejected);
  return outcome ? { outcome, targets: [node.outcomes[outcome]] } : undefined;
};

const consensusSelection = (
  node: Extract<PipelineNode, { readonly kind: 'consensus' }>,
  facts: ValidatedFacts,
): Selection | undefined => {
  const aggregate = facts.consensusByNode.get(node.key);
  const approvals = aggregate?.approvals ?? 0;
  const rejections = aggregate?.rejections ?? 0;
  const remaining = node.candidates.length - (aggregate?.total ?? 0);
  const outcome = selectConsensusOutcome(node, approvals, rejections, remaining);
  return outcome ? { outcome, targets: [node.outcomes[outcome]] } : undefined;
};

const gateSelection = (
  node: Extract<PipelineNode, { readonly kind: 'humanGate' }>,
  facts: ValidatedFacts,
): Selection | undefined => {
  const resolution = facts.gateResolutionByNode.get(node.key);
  const route = resolution
    ? node.resolutions.find((candidate) => candidate.resolution === resolution.resolution)
    : undefined;
  return route ? { outcome: route.resolution, targets: [route.to] } : undefined;
};

const validateCausality = (
  pipeline: CompiledPipeline,
  facts: ValidatedFacts,
  graph: EvaluationIndex,
  faults: MutableFault[],
): void => {
  const byNode = facts.nodeByKey;
  facts.candidateVerdicts.forEach(({ fact, sourceIndex }) => {
    if (!byNode.has(fact.nodeKey)) {
      addFault(
        faults,
        'FACT_PREMATURE',
        `/candidateVerdicts/${sourceIndex}`,
        'Verdict node is not activated.',
      );
    }
  });
  facts.gateResolutions.forEach(({ fact, sourceIndex }) => {
    if (!byNode.has(fact.nodeKey)) {
      addFault(
        faults,
        'FACT_PREMATURE',
        `/gateResolutions/${sourceIndex}`,
        'Gate node is not activated.',
      );
    }
  });
  facts.nodes.forEach(({ fact, sourceIndex }) => {
    if (fact.key === pipeline.entry) {
      return;
    }
    const activated = (graph.incomingByKey.get(fact.key) ?? []).some((edgeOffset) => {
      const edge = pipeline.edges[edgeOffset];
      if (edge?.role !== 'activation') {
        return false;
      }
      const source = byNode.get(edge.from);
      return source?.state === 'terminal' && source.outcome === edge.outcome;
    });
    if (!activated) {
      addFault(
        faults,
        'FACT_CAUSAL',
        `/nodes/${sourceIndex}`,
        'Node fact has no activation cause.',
      );
    }
    const owningFork = graph.regionOwnerByNode.get(fact.key);
    const forkFact = owningFork ? byNode.get(owningFork) : undefined;
    if (owningFork && (forkFact?.state !== 'terminal' || forkFact.outcome !== 'forked')) {
      addFault(
        faults,
        'FACT_CAUSAL',
        `/nodes/${sourceIndex}`,
        'Fork-region fact is missing its owning fork.',
      );
    }
  });
  facts.nodes.forEach(({ fact, sourceIndex }) => {
    if (fact.state !== 'terminal') {
      return;
    }
    const node = graph.nodeByKey.get(fact.key);
    if (!node || node.kind === 'task' || node.kind === 'terminal') {
      return;
    }
    if (node.kind === 'branch') {
      const selection = branchSelection(node, facts.valueByKey);
      if (selection && selection.outcome !== fact.outcome) {
        addFault(
          faults,
          'FACT_OUTCOME',
          `/nodes/${sourceIndex}/outcome`,
          'Branch outcome contradicts fact.',
        );
        return;
      }
      const edge = (graph.outgoingByKey.get(node.key) ?? [])
        .map((edgeOffset) => pipeline.edges[edgeOffset])
        .find((candidate) => candidate?.outcome === fact.outcome);
      if ((selection && edge?.to !== selection.target) || (edge && !byNode.has(edge.to))) {
        addFault(
          faults,
          'FACT_CAUSAL',
          `/nodes/${sourceIndex}`,
          'Terminal branch is missing or contradicts its atomic target.',
        );
      }
      return;
    }
    const selection = selectorSelection(node, pipeline, facts, graph);
    if (!selection) {
      addFault(
        faults,
        'FACT_PREMATURE',
        `/nodes/${sourceIndex}`,
        'Terminal selector has no determined outcome.',
      );
      return;
    }
    if (selection.outcome !== fact.outcome) {
      addFault(
        faults,
        'FACT_OUTCOME',
        `/nodes/${sourceIndex}/outcome`,
        'Selector outcome contradicts facts.',
      );
      return;
    }
    if (selection.targets.some((target) => !byNode.has(target))) {
      addFault(
        faults,
        'FACT_CAUSAL',
        `/nodes/${sourceIndex}`,
        'Terminal selector is missing its atomic target.',
      );
    }
  });
};

const reachedTerminals = (
  pipeline: CompiledPipeline,
  facts: ValidatedFacts,
  index: EvaluationIndex,
): readonly { readonly key: string; readonly outcome: string }[] => {
  const byNode = facts.nodeByKey;
  return pipeline.topologicalOrder.flatMap((key) => {
    const node = index.nodeByKey.get(key);
    if (node?.kind !== 'terminal') {
      return [];
    }
    const fact = byNode.get(node.key);
    return fact?.state === 'enabled' ||
      (fact?.state === 'terminal' && fact.outcome === node.outcome)
      ? [{ key: node.key, outcome: node.outcome }]
      : [];
  });
};

const branchSelection = (
  node: BranchNode,
  values: ReadonlyMap<string, JsonScalar>,
): { readonly outcome: string; readonly target: string } | undefined => {
  const value = values.get(node.fact);
  if (value === undefined && !values.has(node.fact)) {
    return undefined;
  }
  if (value === undefined) {
    return undefined;
  }
  const match = node.cases.find((entry) =>
    entry.when.op === 'equals'
      ? jsonScalarsEqual(entry.when.value, value)
      : entry.when.values.some((candidate) => jsonScalarsEqual(candidate, value)),
  );
  const selected = match ?? node.default;
  return selected ? { outcome: selected.name, target: selected.to } : undefined;
};

const selectorSelection = (
  node: Exclude<PipelineNode, { readonly kind: 'task' | 'terminal' }>,
  pipeline: CompiledPipeline,
  facts: ValidatedFacts,
  index: EvaluationIndex,
): Selection | undefined => {
  if (node.kind === 'branch') {
    const selection = branchSelection(node, facts.valueByKey);
    return selection ? { outcome: selection.outcome, targets: [selection.target] } : undefined;
  }
  if (node.kind === 'fork') {
    const region = index.regionByFork.get(node.key);
    return region
      ? {
          outcome: 'forked',
          targets: [...region.branches.map((branch) => branch.entry), region.join].sort(
            (left, right) =>
              (index.topologicalPosition.get(left) ?? 0) -
              (index.topologicalPosition.get(right) ?? 0),
          ),
        }
      : undefined;
  }
  if (node.kind === 'join') {
    return joinSelection(node, facts, index);
  }
  return node.kind === 'consensus' ? consensusSelection(node, facts) : gateSelection(node, facts);
};

const firstAction = (
  pipeline: CompiledPipeline,
  facts: ValidatedFacts,
  index: EvaluationIndex,
): PipelineDecision | undefined => {
  const byNode = facts.nodeByKey;
  if (!byNode.has(pipeline.entry)) {
    return { kind: 'activate', cause: { kind: 'entry' }, nodeKeys: [pipeline.entry] };
  }
  for (const key of pipeline.topologicalOrder) {
    const node = index.nodeByKey.get(key);
    const fact = byNode.get(key);
    if (node?.kind === 'task' && fact?.state === 'terminal') {
      const edge = (index.outgoingByKey.get(key) ?? [])
        .map((edgeOffset) => pipeline.edges[edgeOffset])
        .find((candidate) => candidate?.outcome === fact.outcome);
      if (edge && !byNode.has(edge.to)) {
        return {
          kind: 'activate',
          cause: { kind: 'node', nodeKey: key, outcome: fact.outcome },
          nodeKeys: [edge.to],
        };
      }
    }
    if (node && node.kind !== 'task' && node.kind !== 'terminal' && fact?.state === 'enabled') {
      const selection = selectorSelection(node, pipeline, facts, index);
      const activate = selection?.targets.filter((target) => !byNode.has(target)) ?? [];
      if (selection && activate.length > 0) {
        return {
          kind: 'select',
          nodeKey: key,
          outcome: selection.outcome,
          activate,
        };
      }
    }
  }
  return undefined;
};

const firstWait = (
  pipeline: CompiledPipeline,
  facts: ValidatedFacts,
  index: EvaluationIndex,
): PipelineDecision | undefined => {
  const byNode = facts.nodeByKey;
  for (const key of pipeline.topologicalOrder) {
    const node = index.nodeByKey.get(key);
    const fact = byNode.get(key);
    if (fact?.state !== 'enabled') {
      continue;
    }
    if (node?.kind === 'task') {
      return { kind: 'wait', nodeKey: key, reason: 'task-incomplete' };
    }
    if (node?.kind === 'branch' && !facts.valueByKey.has(node.fact)) {
      return { kind: 'wait', nodeKey: key, reason: 'branch-fact-missing' };
    }
    if (node?.kind === 'join' && !joinSelection(node, facts, index)) {
      return { kind: 'wait', nodeKey: key, reason: 'join-incomplete' };
    }
    if (node?.kind === 'consensus' && !consensusSelection(node, facts)) {
      return { kind: 'wait', nodeKey: key, reason: 'consensus-incomplete' };
    }
    if (node?.kind === 'humanGate' && !gateSelection(node, facts)) {
      return { kind: 'wait', nodeKey: key, reason: 'gate-unresolved' };
    }
  }
  return undefined;
};

export const decidePipeline = (
  pipelineInput: CompiledPipeline,
  factsInput: PipelineFacts,
): PipelineDecision => {
  const compiled = validateCompiledInternally(pipelineInput);
  if (!compiled.ok) {
    return reject([
      { code: 'PIPELINE_INVALID', path: '', message: 'Compiled pipeline is invalid.' },
    ]);
  }
  const index = evaluationIndex(compiled.pipeline, compiled.kernel, compiled.topologicalOffsets);
  const faults: MutableFault[] = [];
  const facts = validateFactShape(factsInput, compiled.pipeline, index, faults);
  if (facts) {
    validateCausality(compiled.pipeline, facts, index, faults);
  }
  if (faults.length > 0 || !facts) {
    return reject(faults);
  }
  const terminals = reachedTerminals(compiled.pipeline, facts, index);
  if (terminals.length > 1) {
    return reject([
      { code: 'FACT_CAUSAL', path: '/nodes', message: 'Multiple terminals are reached.' },
    ]);
  }
  const terminal = terminals[0];
  if (terminal) {
    return { kind: 'terminal', nodeKey: terminal.key, outcome: terminal.outcome };
  }
  return (
    firstAction(compiled.pipeline, facts, index) ??
    firstWait(compiled.pipeline, facts, index) ?? { kind: 'noop', reason: 'quiescent' }
  );
};
