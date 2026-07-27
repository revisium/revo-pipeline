import { PIPELINE_LIMITS } from '../../policy/index.js';
import type { FactDefinition, PipelineNode } from '../../spec/index.js';
import type { DefinitionValidationContext } from './definition-validation-context.js';
import { validateBranchNode } from './validate-branch-node.js';
import { validateConsensusNode } from './validate-consensus-node.js';
import { validateForkNode } from './validate-fork-node.js';
import { validateHumanGateNode } from './validate-human-gate-node.js';
import { validateJoinNode } from './validate-join-node.js';

type ValidatedNode = {
  readonly node: PipelineNode;
  readonly sourceIndex: number;
  readonly uniqueKey: boolean;
};

const TASK_OUTCOMES = ['cancelled', 'completed', 'failed', 'skipped'] as const;
const NODE_KINDS: ReadonlySet<string> = new Set([
  'branch',
  'consensus',
  'fork',
  'humanGate',
  'join',
  'task',
  'terminal',
]);

const isStringRecord = (
  value: unknown,
  context: DefinitionValidationContext,
): value is Record<string, string> =>
  context.isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');

const isPipelineNode = (
  value: unknown,
  context: DefinitionValidationContext,
): value is PipelineNode => {
  if (!context.isRecord(value) || typeof value.key !== 'string') {
    return false;
  }
  switch (value.kind) {
    case 'task':
      return isStringRecord(value.outcomes, context);
    case 'branch':
      return (
        typeof value.fact === 'string' &&
        Array.isArray(value.cases) &&
        value.cases.every(
          (entry) =>
            context.isRecord(entry) &&
            typeof entry.name === 'string' &&
            typeof entry.to === 'string' &&
            context.isRecord(entry.when) &&
            ((entry.when.op === 'equals' && 'value' in entry.when) ||
              (entry.when.op === 'oneOf' && Array.isArray(entry.when.values))),
        ) &&
        (value.default === null ||
          (context.isRecord(value.default) &&
            typeof value.default.name === 'string' &&
            typeof value.default.to === 'string'))
      );
    case 'fork':
      return (
        typeof value.join === 'string' &&
        Array.isArray(value.branches) &&
        value.branches.every(
          (entry) =>
            context.isRecord(entry) &&
            typeof entry.name === 'string' &&
            typeof entry.entry === 'string' &&
            typeof entry.exit === 'string',
        )
      );
    case 'join':
      return (
        typeof value.fork === 'string' &&
        context.isRecord(value.policy) &&
        isStringRecord(value.outcomes, context)
      );
    case 'consensus':
      return (
        Array.isArray(value.candidates) &&
        value.candidates.every((entry) => typeof entry === 'string') &&
        context.isRecord(value.policy) &&
        isStringRecord(value.outcomes, context)
      );
    case 'humanGate':
      return (
        typeof value.subject === 'string' &&
        Array.isArray(value.resolutions) &&
        value.resolutions.every(
          (entry) =>
            context.isRecord(entry) &&
            typeof entry.resolution === 'string' &&
            typeof entry.to === 'string',
        )
      );
    case 'terminal':
      return typeof value.outcome === 'string';
    default:
      return false;
  }
};

export const validatePipelineNodes = (
  value: unknown,
  facts: readonly FactDefinition[],
  context: DefinitionValidationContext,
): readonly ValidatedNode[] => {
  if (!context.requireArray(value, '/nodes', PIPELINE_LIMITS.definition.nodes)) {
    return [];
  }
  const nodes: ValidatedNode[] = [];
  const keys = new Set<string>();
  const factTypes = new Map(facts.map((fact) => [fact.key, fact.type]));
  let candidateTotal = 0;
  let resolutionTotal = 0;
  value.forEach((entry, index) => {
    const path = `/nodes/${index}`;
    if (!context.isRecord(entry)) {
      context.addFault('DEF_TYPE', path, 'Expected pipeline node.');
      return;
    }
    const kindValid = typeof entry.kind === 'string' && NODE_KINDS.has(entry.kind);
    if (!kindValid) {
      context.addFault('DEF_TYPE', `${path}/kind`, 'Invalid node kind.');
    }
    const key = entry.key;
    const keyValid = context.requireKey(key, `${path}/key`);
    const uniqueKey = keyValid && !keys.has(key);
    if (keyValid && !uniqueKey) {
      context.addFault('DEF_DUPLICATE', `${path}/key`, 'Duplicate node key.');
    }
    if (keyValid) {
      keys.add(key);
    }
    switch (entry.kind) {
      case 'task':
        context.unknownFields(entry, ['key', 'kind', 'outcomes'], path);
        context.validateExactRoutes(entry.outcomes, TASK_OUTCOMES, `${path}/outcomes`);
        break;
      case 'branch':
        validateBranchNode(entry, path, factTypes, context);
        break;
      case 'fork':
        validateForkNode(entry, path, context);
        break;
      case 'join':
        validateJoinNode(entry, path, context);
        break;
      case 'consensus':
        candidateTotal += validateConsensusNode(entry, path, context);
        break;
      case 'humanGate':
        resolutionTotal += validateHumanGateNode(entry, path, context);
        break;
      case 'terminal':
        context.unknownFields(entry, ['key', 'kind', 'outcome'], path);
        context.requireDisplayString(entry.outcome, `${path}/outcome`);
        break;
    }
    if (kindValid && keyValid && isPipelineNode(entry, context)) {
      nodes.push({ node: entry, sourceIndex: index, uniqueKey });
    }
  });
  if (candidateTotal > PIPELINE_LIMITS.definition.candidatesTotal) {
    context.addFault('DEF_LIMIT', '/nodes', 'Candidate total exceeded.');
  }
  if (resolutionTotal > PIPELINE_LIMITS.definition.resolutionsTotal) {
    context.addFault('DEF_LIMIT', '/nodes', 'Resolution total exceeded.');
  }
  return nodes;
};
