import { inspectPortableValueSet, PIPELINE_LIMITS } from '../../policy/index.js';
import type { PipelineNode } from '../../spec/index.js';
import type { DefinitionValidationResult } from '../contracts/definition-validation-result.js';
import { DefinitionValidationContext } from './definition-validation-context.js';
import { validateFacts } from './validate-facts.js';
import { validatePipelineNodes } from './validate-pipeline-nodes.js';

const definitionArrayLimit = (path: string): number => {
  if (path === '/facts') {
    return PIPELINE_LIMITS.definition.declaredFacts;
  }
  if (path === '/nodes') {
    return PIPELINE_LIMITS.definition.nodes;
  }
  if (/^\/nodes\/(?:0|[1-9]\d*)\/cases$/u.test(path)) {
    return PIPELINE_LIMITS.definition.branchCasesPerNode;
  }
  if (/^\/nodes\/(?:0|[1-9]\d*)\/cases\/(?:0|[1-9]\d*)\/when\/values$/u.test(path)) {
    return PIPELINE_LIMITS.definition.predicateValuesPerCase;
  }
  if (/^\/nodes\/(?:0|[1-9]\d*)\/branches$/u.test(path)) {
    return PIPELINE_LIMITS.definition.forkBranchesPerNode;
  }
  if (/^\/nodes\/(?:0|[1-9]\d*)\/candidates$/u.test(path)) {
    return PIPELINE_LIMITS.definition.candidatesPerNode;
  }
  if (/^\/nodes\/(?:0|[1-9]\d*)\/resolutions$/u.test(path)) {
    return PIPELINE_LIMITS.definition.resolutionsPerNode;
  }
  return PIPELINE_LIMITS.facts.total;
};

const emptyResult = (context: DefinitionValidationContext): DefinitionValidationResult => ({
  canCompile: false,
  entry: '',
  facts: [],
  nodes: [],
  sourceIndexes: new Map(),
  sourceNodes: new Map(),
  faults: context.faults,
});

export const validateDefinition = (input: unknown): DefinitionValidationResult => {
  const context = new DefinitionValidationContext();
  const portable = inspectPortableValueSet(input, { arrayLimit: definitionArrayLimit });
  if (portable.issues.length > 0) {
    for (const issue of portable.issues) {
      context.addFault(
        issue.code === 'limit' ? 'DEF_LIMIT' : 'DEF_TYPE',
        issue.path,
        'Invalid portable input.',
      );
    }
    return emptyResult(context);
  }
  if (!context.isRecord(portable.value)) {
    context.addFault('DEF_TYPE', '', 'Expected definition object.');
    return emptyResult(context);
  }
  const value = portable.value;
  context.unknownFields(value, ['entry', 'facts', 'nodes', 'schemaVersion'], '');
  if (value.schemaVersion !== 1) {
    context.addFault('DEF_SCHEMA', '/schemaVersion', 'schemaVersion must be 1.');
  }
  context.requireKey(value.entry, '/entry');
  const facts = validateFacts(value.facts, context);
  const validatedNodes = validatePipelineNodes(value.nodes, facts, context);
  const nodes = validatedNodes.filter((record) => record.uniqueKey).map((record) => record.node);
  const sourceIndexes = new Map<string, number>();
  const sourceNodes = new Map<string, PipelineNode>();
  for (const record of validatedNodes) {
    if (record.uniqueKey) {
      sourceIndexes.set(record.node.key, record.sourceIndex);
      sourceNodes.set(record.node.key, record.node);
    }
  }
  return {
    canCompile: true,
    entry: typeof value.entry === 'string' ? value.entry : '',
    facts,
    nodes,
    sourceIndexes,
    sourceNodes,
    faults: context.faults,
  };
};
