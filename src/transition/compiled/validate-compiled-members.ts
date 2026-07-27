import { compareUnicodeCodePoints, isValidKey, isValidSemanticName } from '../../policy/index.js';
import { PIPELINE_LIMITS } from '../../policy/index.js';
import type { CompiledPipeline } from '../../spec/index.js';
import { validateCompiledNode } from './validate-compiled-node.js';

const ROOT_FIELDS = [
  'edges',
  'entry',
  'facts',
  'forkRegions',
  'incomingIndex',
  'nodeIndex',
  'nodes',
  'outgoingIndex',
  'schemaVersion',
  'topologicalOrder',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const keys = Object.keys(value).sort(compareUnicodeCodePoints);
  const expected = [...fields].sort(compareUnicodeCodePoints);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

const hasCompiledPipelineShape = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & CompiledPipeline =>
  hasExactFields(value, ROOT_FIELDS) &&
  value.schemaVersion === 1 &&
  typeof value.entry === 'string' &&
  Array.isArray(value.nodes) &&
  Array.isArray(value.edges) &&
  Array.isArray(value.facts) &&
  Array.isArray(value.topologicalOrder) &&
  Array.isArray(value.forkRegions) &&
  Array.isArray(value.nodeIndex) &&
  Array.isArray(value.incomingIndex) &&
  Array.isArray(value.outgoingIndex);

const hasSafeIntegerArray = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.every((entry) => Number.isSafeInteger(entry) && entry >= 0);

const isCanonicalStringArray = (values: readonly string[]): boolean =>
  values.every(
    (value, index) => index === 0 || compareUnicodeCodePoints(values[index - 1] ?? '', value) < 0,
  );

const membersHaveShape = (pipeline: CompiledPipeline): boolean =>
  pipeline.facts.every(
    (fact) =>
      isRecord(fact) &&
      hasExactFields(fact, ['key', 'type']) &&
      isValidKey(fact.key) &&
      ['boolean', 'number', 'string', 'null'].includes(fact.type),
  ) &&
  pipeline.edges.every(
    (edge) =>
      isRecord(edge) &&
      hasExactFields(edge, ['branch', 'fork', 'from', 'outcome', 'role', 'to']) &&
      isValidKey(edge.from) &&
      isValidSemanticName(edge.outcome) &&
      isValidKey(edge.to) &&
      (edge.role === 'activation' || edge.role === 'readiness') &&
      (edge.fork === null || isValidKey(edge.fork)) &&
      (edge.branch === null || isValidSemanticName(edge.branch)),
  ) &&
  pipeline.topologicalOrder.every((key) => typeof key === 'string') &&
  pipeline.nodeIndex.every(
    (entry) =>
      isRecord(entry) &&
      hasExactFields(entry, ['key', 'node']) &&
      isValidKey(entry.key) &&
      Number.isSafeInteger(entry.node) &&
      entry.node >= 0,
  ) &&
  [...pipeline.incomingIndex, ...pipeline.outgoingIndex].every(
    (entry) =>
      isRecord(entry) &&
      hasExactFields(entry, ['edges', 'key']) &&
      isValidKey(entry.key) &&
      hasSafeIntegerArray(entry.edges),
  ) &&
  pipeline.forkRegions.every(
    (region) =>
      isRecord(region) &&
      hasExactFields(region, ['branches', 'fork', 'join']) &&
      isValidKey(region.fork) &&
      isValidKey(region.join) &&
      Array.isArray(region.branches) &&
      region.branches.every(
        (branch) =>
          isRecord(branch) &&
          hasExactFields(branch, ['entry', 'exit', 'members', 'name']) &&
          isValidSemanticName(branch.name) &&
          isValidKey(branch.entry) &&
          isValidKey(branch.exit) &&
          Array.isArray(branch.members) &&
          branch.members.every(isValidKey) &&
          isCanonicalStringArray(branch.members),
      ),
  );

const arraysAreBounded = (pipeline: CompiledPipeline): boolean =>
  pipeline.nodes.length <= PIPELINE_LIMITS.definition.nodes &&
  pipeline.edges.length <= PIPELINE_LIMITS.definition.edges &&
  pipeline.facts.length <= PIPELINE_LIMITS.definition.declaredFacts &&
  pipeline.nodes.every(isRecord) &&
  pipeline.nodes.reduce(
    (total, node) =>
      total +
      (node.kind === 'consensus' && Array.isArray(node.candidates) ? node.candidates.length : 0),
    0,
  ) <= PIPELINE_LIMITS.definition.candidatesTotal &&
  pipeline.nodes.reduce(
    (total, node) =>
      total +
      (node.kind === 'humanGate' && Array.isArray(node.resolutions) ? node.resolutions.length : 0),
    0,
  ) <= PIPELINE_LIMITS.definition.resolutionsTotal;

const hasCanonicalCollections = (pipeline: CompiledPipeline): boolean => {
  const nodeKeys = pipeline.nodes.map((node) => node.key);
  const factKeys = pipeline.facts.map((fact) => fact.key);
  return (
    nodeKeys.every(
      (key, index) => index === 0 || compareUnicodeCodePoints(nodeKeys[index - 1] ?? '', key) < 0,
    ) &&
    factKeys.every(
      (key, index) => index === 0 || compareUnicodeCodePoints(factKeys[index - 1] ?? '', key) < 0,
    ) &&
    pipeline.nodeIndex.length === pipeline.nodes.length &&
    pipeline.nodeIndex.every(
      (entry, index) => entry.key === nodeKeys[index] && entry.node === index,
    )
  );
};

export const validateCompiledMembers = (value: unknown): value is CompiledPipeline => {
  if (!isRecord(value) || !hasCompiledPipelineShape(value)) {
    return false;
  }
  const pipeline = value;
  if (
    !arraysAreBounded(pipeline) ||
    !membersHaveShape(pipeline) ||
    !hasCanonicalCollections(pipeline) ||
    !isValidKey(pipeline.entry) ||
    !pipeline.nodes.some((node) => node.key === pipeline.entry)
  ) {
    return false;
  }
  const facts = new Map(pipeline.facts.map((fact) => [fact.key, fact.type]));
  return pipeline.nodes.every((node) => validateCompiledNode(node, facts));
};
