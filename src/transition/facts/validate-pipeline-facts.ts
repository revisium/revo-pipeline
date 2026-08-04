import { PIPELINE_LIMITS } from '../../policy/index.js';
import type { PipelineFacts } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { DecisionFaultCollector } from './decision-fault-collector.js';
import { validateCandidateVerdicts } from './validate-candidate-verdicts.js';
import { validateGateResolutions } from './validate-gate-resolutions.js';
import { validateNodeFacts } from './validate-node-facts.js';
import { validateValueFacts } from './validate-value-facts.js';
import type { ValidatedFacts } from './validated-facts.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const collection = (
  value: unknown,
  path: string,
  maximum: number,
  faults: DecisionFaultCollector,
): readonly unknown[] => {
  if (!Array.isArray(value)) {
    faults.add('FACT_TYPE', path, 'Expected fact array.');
    return [];
  }
  if (value.length > maximum) {
    faults.add('FACT_LIMIT', path, 'Fact collection limit exceeded.');
    return [];
  }
  return value as readonly unknown[];
};

export const validatePipelineFacts = (
  input: PipelineFacts,
  context: DecisionContext,
  faults: DecisionFaultCollector,
): ValidatedFacts | undefined => {
  if (!isRecord(input)) {
    faults.add('FACT_TYPE', '', 'Invalid facts object.');
    return undefined;
  }
  const verdicts = collection(
    input['candidateVerdicts'],
    '/candidateVerdicts',
    PIPELINE_LIMITS.facts.candidateVerdicts,
    faults,
  );
  const resolutions = collection(
    input['gateResolutions'],
    '/gateResolutions',
    PIPELINE_LIMITS.facts.gateResolutions,
    faults,
  );
  const nodes = collection(input['nodes'], '/nodes', PIPELINE_LIMITS.facts.nodes, faults);
  const values = collection(input['values'], '/values', PIPELINE_LIMITS.facts.values, faults);
  if (
    values.length + nodes.length + verdicts.length + resolutions.length >
    PIPELINE_LIMITS.facts.total
  ) {
    faults.add('FACT_LIMIT', '', 'Aggregate fact limit exceeded.');
    return undefined;
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
