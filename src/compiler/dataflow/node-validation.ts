import {
  EmptyObjectSchema,
  appendJsonPointer,
  isAgentActivityInputValueSchema,
  projectValueSchema,
  valueSchemasEqual,
  type DiagnosticCollector,
  type JsonPointer,
  type ValueSchema,
} from '../../foundation/index.js';
import { type SourceNode, type SourceRegion } from '../../source/index.js';
import type { LinkedSource } from '../linking/index.js';
import { validateChoiceDomains, validateRepeatCondition } from './condition-validation.js';
import { validateMapping } from './mapping-validation.js';
import type { SchemaResolver, SelectorEnvironment } from './schema-resolver.js';

const isStringSchema = (schema: ValueSchema): boolean =>
  'anyOf' in schema ? schema.anyOf.every(isStringSchema) : schema.type === 'string';

export type NodeValidationContext = {
  readonly path: JsonPointer;
  readonly environment: SelectorEnvironment;
  readonly resolver: SchemaResolver;
  readonly collector: DiagnosticCollector;
  readonly linked: LinkedSource;
  readonly validateChild: (
    region: SourceRegion,
    path: JsonPointer,
    environment: SelectorEnvironment,
  ) => void;
};

const validateActivity = (
  node: Extract<SourceNode, { readonly kind: 'agent' | 'script' }>,
  context: NodeValidationContext,
): void => {
  if (node.kind === 'agent' && !isAgentActivityInputValueSchema(node.inputSchema)) {
    context.collector.add(
      'DATA_SCHEMA_INCOMPATIBLE',
      appendJsonPointer(context.path, 'inputSchema'),
    );
  }
  validateMapping(
    node.input,
    node.inputSchema,
    appendJsonPointer(context.path, 'input'),
    node.id,
    context.resolver,
    context.collector,
  );
};

const validateChoice = (
  node: Extract<SourceNode, { readonly kind: 'choice' }>,
  context: NodeValidationContext,
): void => {
  const schema = context.resolver.selector(
    node.selector,
    appendJsonPointer(context.path, 'selector'),
    node.id,
  );
  if (schema !== null) {
    validateChoiceDomains(
      schema,
      node.cases.map(({ when }) => when),
      appendJsonPointer(context.path, 'cases'),
      context.collector,
    );
  }
};

const validateParallel = (
  node: Extract<SourceNode, { readonly kind: 'parallel' }>,
  context: NodeValidationContext,
): void => {
  for (const [index, branch] of node.branches.entries()) {
    const branchPath = `${context.path}/branches/${index}` as JsonPointer;
    validateMapping(
      branch.input,
      branch.region.inputSchema ?? EmptyObjectSchema,
      appendJsonPointer(branchPath, 'input'),
      node.id,
      context.resolver,
      context.collector,
    );
    context.validateChild(branch.region, appendJsonPointer(branchPath, 'region'), {
      ...context.environment,
      scopeInput: branch.region.inputSchema ?? EmptyObjectSchema,
    });
  }
};

const repeatEnvironment = (
  node: Extract<SourceNode, { readonly kind: 'repeat' }>,
  environment: SelectorEnvironment,
): SelectorEnvironment => ({
  ...environment,
  repeat: {
    iteration: { type: 'integer', minimum: 0, maximum: node.maximumIterations - 1 },
    previousOutput: node.body.outputSchema,
  },
  regionOutput: node.body.outputSchema,
});

const validateRepeat = (
  node: Extract<SourceNode, { readonly kind: 'repeat' }>,
  context: NodeValidationContext,
): void => {
  const bodyInput = node.body.inputSchema ?? EmptyObjectSchema;
  validateMapping(
    node.initialInput,
    bodyInput,
    appendJsonPointer(context.path, 'initialInput'),
    node.id,
    context.resolver,
    context.collector,
  );
  const afterBody = repeatEnvironment(node, context.environment);
  validateMapping(
    node.nextInput,
    bodyInput,
    appendJsonPointer(context.path, 'nextInput'),
    node.id,
    context.resolver,
    context.collector,
    afterBody,
  );
  validateRepeatCondition(
    node.continueWhen,
    appendJsonPointer(context.path, 'continueWhen'),
    node.id,
    context.resolver,
    context.collector,
    afterBody,
  );
  validateMapping(
    node.output,
    node.outputSchema,
    appendJsonPointer(context.path, 'output'),
    node.id,
    context.resolver,
    context.collector,
    afterBody,
  );
  const childEnvironment: SelectorEnvironment = {
    ...context.environment,
    scopeInput: bodyInput,
    ...(afterBody.repeat === undefined ? {} : { repeat: afterBody.repeat }),
  };
  context.validateChild(node.body, appendJsonPointer(context.path, 'body'), childEnvironment);
};

const validateMap = (
  node: Extract<SourceNode, { readonly kind: 'map' }>,
  context: NodeValidationContext,
): void => {
  const items = context.resolver.mapItems(node);
  if (items === null) {
    return;
  }
  const itemKey = projectValueSchema(items.item, node.itemKeyPointer);
  if (itemKey === null) {
    context.collector.add('DATA_POINTER_STATIC', appendJsonPointer(context.path, 'itemKeyPointer'));
    return;
  }
  if (!isStringSchema(itemKey)) {
    context.collector.add(
      'DATA_SCHEMA_INCOMPATIBLE',
      appendJsonPointer(context.path, 'itemKeyPointer'),
    );
  }
  const mapEnvironment: SelectorEnvironment = {
    ...context.environment,
    map: { item: items.item, itemKey },
  };
  const bodyInput = node.body.inputSchema ?? EmptyObjectSchema;
  validateMapping(
    node.bodyInput,
    bodyInput,
    appendJsonPointer(context.path, 'bodyInput'),
    node.id,
    context.resolver,
    context.collector,
    mapEnvironment,
  );
  context.validateChild(node.body, appendJsonPointer(context.path, 'body'), {
    ...mapEnvironment,
    scopeInput: bodyInput,
  });
};

const validateConsensus = (
  node: Extract<SourceNode, { readonly kind: 'consensus' }>,
  context: NodeValidationContext,
): void => {
  for (const [index, participant] of node.participants.entries()) {
    if (!isAgentActivityInputValueSchema(participant.inputSchema)) {
      context.collector.add(
        'DATA_SCHEMA_INCOMPATIBLE',
        `${context.path}/participants/${index}/inputSchema`,
      );
    }
    validateMapping(
      participant.input,
      participant.inputSchema,
      `${context.path}/participants/${index}/input`,
      node.id,
      context.resolver,
      context.collector,
    );
  }
};

const validateCall = (
  node: Extract<SourceNode, { readonly kind: 'call' }>,
  context: NodeValidationContext,
): void => {
  const target = context.linked.callsByPath.get(context.path)?.target;
  if (target === undefined) {
    return;
  }
  validateMapping(
    node.input,
    target.inputSchema,
    appendJsonPointer(context.path, 'input'),
    node.id,
    context.resolver,
    context.collector,
  );
  if (!valueSchemasEqual(node.outputSchema, target.outputSchema)) {
    context.collector.add(
      'DATA_SCHEMA_INCOMPATIBLE',
      appendJsonPointer(context.path, 'outputSchema'),
    );
  }
};

const validateEnd = (
  node: Extract<SourceNode, { readonly kind: 'end' }>,
  region: SourceRegion,
  context: NodeValidationContext,
): void => {
  const outputSchema = region.exits.find(({ outcome }) => outcome === node.outcome)?.outputSchema;
  if (outputSchema !== undefined) {
    validateMapping(
      node.output,
      outputSchema,
      appendJsonPointer(context.path, 'output'),
      node.id,
      context.resolver,
      context.collector,
    );
  }
};

export const validateNodeDataflow = (
  node: SourceNode,
  region: SourceRegion,
  context: NodeValidationContext,
): void => {
  switch (node.kind) {
    case 'agent':
    case 'script':
      return validateActivity(node, context);
    case 'choice':
      return validateChoice(node, context);
    case 'parallel':
      return validateParallel(node, context);
    case 'repeat':
      return validateRepeat(node, context);
    case 'map':
      return validateMap(node, context);
    case 'consensus':
      return validateConsensus(node, context);
    case 'call':
      return validateCall(node, context);
    case 'end':
      return validateEnd(node, region, context);
    case 'wait':
    case 'humanGate':
      return;
  }
};
