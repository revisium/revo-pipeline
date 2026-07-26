import type { DecisionFault, DecisionFaultCode, PipelineDecision } from '../errors/index.js';
import {
  compareUnicodeCodePoints,
  DECISION_FAULT_PHASES,
  inspectPortableValueSet,
  isValidKey,
  jsonScalarsEqual,
  orderFaults,
  PIPELINE_LIMITS,
} from '../policy/index.js';
import type {
  BranchNode,
  CompiledPipeline,
  JsonScalar,
  NodeFact,
  PipelineFacts,
  PipelineNode,
  PipelineValueFact,
} from '../spec/index.js';
import { validateCompiledPipeline } from './validate-compiled-pipeline.js';

type MutableFault = { code: DecisionFaultCode; path: string; message: string };
type ValidatedFacts = {
  readonly nodes: readonly NodeFact[];
  readonly values: readonly PipelineValueFact[];
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
  DECISION_FAULT_PHASES.some((phase) => (phase.codes as readonly string[]).includes(value));

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
  if (node.kind === 'task') {
    return Object.hasOwn(node.outcomes, outcome);
  }
  if (node.kind === 'branch') {
    return node.cases.some((entry) => entry.name === outcome) || node.default?.name === outcome;
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
): readonly NodeFact[] => {
  const nodes = new Map(pipeline.nodes.map((node) => [node.key, node]));
  const seen = new Set<string>();
  const facts: NodeFact[] = [];
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
      facts.push({ key, state: 'enabled' });
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
    facts.push({ key, state: 'terminal', outcome: entry.outcome });
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
  pipeline: CompiledPipeline,
  faults: MutableFault[],
): void => {
  const nodes = new Map(pipeline.nodes.map((node) => [node.key, node]));
  const seen = new Set<string>();
  input.forEach((entry, index) => {
    if (entry === INVALID_PORTABLE_ENTRY) {
      return;
    }
    const path = `/candidateVerdicts/${index}`;
    if (
      !isRecord(entry) ||
      !hasExactFields(entry, ['candidate', 'nodeKey', 'verdict']) ||
      !isValidKey(entry.nodeKey) ||
      !isValidKey(entry.candidate) ||
      !['abstain', 'approve', 'reject'].includes(String(entry.verdict))
    ) {
      addFault(faults, 'FACT_TYPE', path, 'Invalid candidate verdict fact.');
      return;
    }
    const identity = `${entry.nodeKey}\u0000${entry.candidate}`;
    if (seen.has(identity)) {
      addFault(faults, 'FACT_DUPLICATE', path, 'Duplicate candidate verdict fact.');
    }
    seen.add(identity);
    const node = nodes.get(entry.nodeKey);
    if (node?.kind !== 'consensus') {
      addFault(faults, 'FACT_FOREIGN', `${path}/nodeKey`, 'Foreign verdict node.');
      return;
    }
    if (!node.candidates.includes(entry.candidate)) {
      addFault(faults, 'FACT_CANDIDATE', `${path}/candidate`, 'Candidate is not declared.');
    }
  });
};

const validateGateFacts = (
  input: readonly unknown[],
  pipeline: CompiledPipeline,
  faults: MutableFault[],
): void => {
  const nodes = new Map(pipeline.nodes.map((node) => [node.key, node]));
  const seen = new Set<string>();
  input.forEach((entry, index) => {
    if (entry === INVALID_PORTABLE_ENTRY) {
      return;
    }
    const path = `/gateResolutions/${index}`;
    if (
      !isRecord(entry) ||
      !hasExactFields(entry, ['nodeKey', 'resolution']) ||
      !isValidKey(entry.nodeKey) ||
      typeof entry.resolution !== 'string'
    ) {
      addFault(faults, 'FACT_TYPE', path, 'Invalid gate resolution fact.');
      return;
    }
    if (
      entry.resolution !== entry.resolution.normalize('NFC') ||
      Array.from(entry.resolution).length > PIPELINE_LIMITS.portable.displayCodePoints
    ) {
      addFault(faults, 'FACT_RESOLUTION', `${path}/resolution`, 'Invalid gate resolution.');
    }
    if (seen.has(entry.nodeKey)) {
      addFault(faults, 'FACT_DUPLICATE', path, 'Duplicate gate resolution fact.');
    }
    seen.add(entry.nodeKey);
    const node = nodes.get(entry.nodeKey);
    if (node?.kind !== 'humanGate') {
      addFault(faults, 'FACT_FOREIGN', `${path}/nodeKey`, 'Foreign gate node.');
      return;
    }
    if (!node.resolutions.some((route) => route.resolution === entry.resolution)) {
      addFault(faults, 'FACT_RESOLUTION', `${path}/resolution`, 'Resolution is not declared.');
    }
  });
};

const validateFactShape = (
  input: unknown,
  pipeline: CompiledPipeline,
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
  if (keys.length !== FACT_FIELDS.length || FACT_FIELDS.some((key) => !keys.includes(key))) {
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
  validateCandidateFacts(verdicts, pipeline, faults);
  validateGateFacts(resolutions, pipeline, faults);
  return {
    values: validateValueFacts(values, pipeline, faults),
    nodes: validateNodeFacts(nodes, pipeline, faults),
  };
};

const nodeFactMap = (facts: readonly NodeFact[]): ReadonlyMap<string, NodeFact> =>
  new Map(facts.map((fact) => [fact.key, fact]));

type EvaluationIndex = {
  readonly nodeByKey: ReadonlyMap<string, PipelineNode>;
  readonly incomingByKey: ReadonlyMap<string, readonly number[]>;
  readonly outgoingByKey: ReadonlyMap<string, readonly number[]>;
};

const evaluationIndex = (pipeline: CompiledPipeline): EvaluationIndex => ({
  nodeByKey: new Map(pipeline.nodes.map((node) => [node.key, node])),
  incomingByKey: new Map(pipeline.incomingIndex.map((entry) => [entry.key, entry.edges])),
  outgoingByKey: new Map(pipeline.outgoingIndex.map((entry) => [entry.key, entry.edges])),
});

const validateCausality = (
  pipeline: CompiledPipeline,
  facts: ValidatedFacts,
  graph: EvaluationIndex,
  faults: MutableFault[],
): void => {
  const byNode = nodeFactMap(facts.nodes);
  const values = new Map(facts.values.map((fact) => [fact.key, fact.value]));
  facts.nodes.forEach((fact, index) => {
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
      addFault(faults, 'FACT_CAUSAL', `/nodes/${index}`, 'Node fact has no activation cause.');
    }
  });
  facts.nodes.forEach((fact, index) => {
    if (fact.state !== 'terminal') {
      return;
    }
    const node = graph.nodeByKey.get(fact.key);
    if (node?.kind !== 'branch') {
      return;
    }
    const selection = branchSelection(node, values);
    if (selection && selection.outcome !== fact.outcome) {
      addFault(
        faults,
        'FACT_OUTCOME',
        `/nodes/${index}/outcome`,
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
        `/nodes/${index}`,
        'Terminal branch is missing or contradicts its atomic target.',
      );
    }
  });
};

const reachedTerminals = (
  pipeline: CompiledPipeline,
  facts: ValidatedFacts,
  index: EvaluationIndex,
): readonly { readonly key: string; readonly outcome: string }[] => {
  const byNode = nodeFactMap(facts.nodes);
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

const firstAction = (
  pipeline: CompiledPipeline,
  facts: ValidatedFacts,
  index: EvaluationIndex,
): PipelineDecision | undefined => {
  const byNode = nodeFactMap(facts.nodes);
  const values = new Map(facts.values.map((fact) => [fact.key, fact.value]));
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
    if (node?.kind === 'branch' && fact?.state === 'enabled') {
      const selection = branchSelection(node, values);
      if (selection && !byNode.has(selection.target)) {
        return {
          kind: 'select',
          nodeKey: key,
          outcome: selection.outcome,
          activate: [selection.target],
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
  const byNode = nodeFactMap(facts.nodes);
  const values = new Map(facts.values.map((fact) => [fact.key, fact.value]));
  for (const key of pipeline.topologicalOrder) {
    const node = index.nodeByKey.get(key);
    const fact = byNode.get(key);
    if (fact?.state !== 'enabled') {
      continue;
    }
    if (node?.kind === 'task') {
      return { kind: 'wait', nodeKey: key, reason: 'task-incomplete' };
    }
    if (node?.kind === 'branch' && !values.has(node.fact)) {
      return { kind: 'wait', nodeKey: key, reason: 'branch-fact-missing' };
    }
  }
  return undefined;
};

export const decidePipeline = (
  pipelineInput: CompiledPipeline,
  factsInput: PipelineFacts,
): PipelineDecision => {
  const compiled = validateCompiledPipeline(pipelineInput);
  if (!compiled.ok) {
    return reject([
      { code: 'PIPELINE_INVALID', path: '', message: 'Compiled pipeline is invalid.' },
    ]);
  }
  const faults: MutableFault[] = [];
  const facts = validateFactShape(factsInput, compiled.pipeline, faults);
  const index = evaluationIndex(compiled.pipeline);
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
