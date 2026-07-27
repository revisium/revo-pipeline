import { inspectPortableValueSet, PIPELINE_LIMITS } from '../../policy/index.js';
import type { PipelineFacts } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { DecisionFaultCollector } from './decision-fault-collector.js';
import { validateCandidateVerdicts } from './validate-candidate-verdicts.js';
import { validateGateResolutions } from './validate-gate-resolutions.js';
import { validateNodeFacts } from './validate-node-facts.js';
import { validateValueFacts } from './validate-value-facts.js';
import type { ValidatedFacts } from './validated-facts.js';

const FACT_FIELDS = ['candidateVerdicts', 'gateResolutions', 'nodes', 'values'] as const;
const INVALID_PORTABLE_ENTRY = Symbol.for('revo-pipeline.invalid-portable-fact');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type PortableIssueIndex = {
  readonly containers: ReadonlySet<string>;
  readonly entries: ReadonlyMap<string, ReadonlySet<number>>;
};
const indexPortableIssues = (paths: readonly string[]): PortableIssueIndex => {
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
const precheckBounds = (input: unknown, faults: DecisionFaultCollector): boolean => {
  if (!isRecord(input)) {
    return true;
  }
  const limits = {
    values: PIPELINE_LIMITS.facts.values,
    nodes: PIPELINE_LIMITS.facts.nodes,
    candidateVerdicts: PIPELINE_LIMITS.facts.candidateVerdicts,
    gateResolutions: PIPELINE_LIMITS.facts.gateResolutions,
  };
  let total = 0;
  let valid = true;
  for (const field of FACT_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor || !('value' in descriptor) || !Array.isArray(descriptor.value)) {
      continue;
    }
    total += descriptor.value.length;
    if (descriptor.value.length > limits[field]) {
      faults.add('FACT_LIMIT', `/${field}`, 'Fact collection limit exceeded.');
      valid = false;
    }
  }
  if (total > PIPELINE_LIMITS.facts.total) {
    faults.add('FACT_LIMIT', '', 'Aggregate fact limit exceeded.');
    valid = false;
  }
  return valid;
};
const collection = (
  value: unknown,
  path: string,
  maximum: number,
  issues: PortableIssueIndex,
  faults: DecisionFaultCollector,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    if (!issues.containers.has(path)) {
      faults.add('FACT_TYPE', path, 'Expected fact array.');
    }
    return [];
  }
  if (value.length > maximum) {
    faults.add('FACT_LIMIT', path, 'Fact collection limit exceeded.');
    return [];
  }
  const entries = value as readonly unknown[];
  return entries.map((entry, index) =>
    issues.entries.get(path)?.has(index) ? INVALID_PORTABLE_ENTRY : entry,
  );
};

export const validatePipelineFacts = (
  input: PipelineFacts,
  context: DecisionContext,
  faults: DecisionFaultCollector,
): ValidatedFacts | undefined => {
  if (!precheckBounds(input, faults)) {
    return undefined;
  }
  const inspected = inspectPortableValueSet(input);
  inspected.issues.forEach((issue) =>
    faults.add(
      issue.code === 'limit' ? 'FACT_LIMIT' : 'FACT_TYPE',
      issue.path,
      'Invalid portable facts.',
    ),
  );
  if (!isRecord(inspected.value)) {
    if (inspected.issues.length === 0) {
      faults.add('FACT_TYPE', '', 'Invalid facts object.');
    }
    return undefined;
  }
  if (inspected.issues.some((issue) => issue.code === 'limit' && issue.path !== '')) {
    return undefined;
  }
  const value = inspected.value;
  const issues = indexPortableIssues(inspected.issues.map((issue) => issue.path));
  const keys = Object.keys(value);
  const keySet = new Set(keys);
  if (keys.length !== FACT_FIELDS.length || FACT_FIELDS.some((key) => !keySet.has(key))) {
    faults.add('FACT_TYPE', '', 'Invalid facts object.');
  }
  const verdicts = collection(
    value.candidateVerdicts,
    '/candidateVerdicts',
    PIPELINE_LIMITS.facts.candidateVerdicts,
    issues,
    faults,
  );
  const resolutions = collection(
    value.gateResolutions,
    '/gateResolutions',
    PIPELINE_LIMITS.facts.gateResolutions,
    issues,
    faults,
  );
  const nodes = collection(value.nodes, '/nodes', PIPELINE_LIMITS.facts.nodes, issues, faults);
  const values = collection(value.values, '/values', PIPELINE_LIMITS.facts.values, issues, faults);
  if (
    values.length + nodes.length + verdicts.length + resolutions.length >
    PIPELINE_LIMITS.facts.total
  ) {
    faults.add('FACT_LIMIT', '', 'Aggregate fact limit exceeded.');
  }
  const candidateVerdicts = validateCandidateVerdicts(verdicts, context, faults);
  const gateResolutions = validateGateResolutions(resolutions, context, faults);
  const validatedNodes = validateNodeFacts(nodes, context, faults);
  const validatedValues = validateValueFacts(values, context, faults);
  return buildValidatedFacts(candidateVerdicts, gateResolutions, validatedNodes, validatedValues);
};

const buildValidatedFacts = (
  candidateVerdicts: ValidatedFacts['candidateVerdicts'],
  gateResolutions: ValidatedFacts['gateResolutions'],
  validatedNodes: ValidatedFacts['nodes'],
  validatedValues: ValidatedFacts['values'],
): ValidatedFacts => {
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
    nodes: validatedNodes,
    nodeByKey: new Map(validatedNodes.map(({ fact }) => [fact.key, fact])),
    values: validatedValues,
    valueByKey: new Map(validatedValues.map((fact) => [fact.key, fact.value])),
  };
};
