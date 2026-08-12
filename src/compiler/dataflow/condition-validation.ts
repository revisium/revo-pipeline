import {
  appendJsonPointer,
  type ChoiceDomain,
  type DiagnosticCollector,
  type JsonPointer,
  type JsonScalar,
  type ValueSchema,
} from '../../foundation/index.js';
import type { RepeatCondition } from '../../source/index.js';
import type { SchemaResolver, SelectorEnvironment } from './schema-resolver.js';

const scalarMatches = (value: JsonScalar, schema: ValueSchema): boolean => {
  if ('anyOf' in schema) {
    return schema.anyOf.some((alternative) => scalarMatches(value, alternative));
  }
  if (value === null) {
    return schema.type === 'null';
  }
  if (typeof value === 'boolean') {
    return schema.type === 'boolean';
  }
  if (typeof value === 'string') {
    return schema.type === 'string' && (schema.enum === undefined || schema.enum.includes(value));
  }
  return (
    (schema.type === 'integer' || schema.type === 'number') &&
    (schema.minimum === undefined || value >= schema.minimum) &&
    (schema.maximum === undefined || value <= schema.maximum)
  );
};

const domainValues = (domain: ChoiceDomain): readonly JsonScalar[] =>
  domain.kind === 'equals' ? [domain.value] : domain.values;

export const validateChoiceDomains = (
  schema: ValueSchema,
  domains: readonly ChoiceDomain[],
  path: JsonPointer,
  collector: DiagnosticCollector,
): void => {
  if (domains.flatMap(domainValues).some((value) => !scalarMatches(value, schema))) {
    collector.add('DATA_SCHEMA_INCOMPATIBLE', path);
  }
};

export const validateRepeatCondition = (
  condition: RepeatCondition,
  path: JsonPointer,
  consumerKey: string,
  resolver: SchemaResolver,
  collector: DiagnosticCollector,
  environment: SelectorEnvironment,
): void => {
  if (condition.kind === 'all' || condition.kind === 'any') {
    for (const [index, nested] of condition.conditions.entries()) {
      validateRepeatCondition(
        nested,
        `${path}/conditions/${index}`,
        consumerKey,
        resolver,
        collector,
        environment,
      );
    }
    return;
  }
  if (condition.kind === 'not') {
    validateRepeatCondition(
      condition.condition,
      appendJsonPointer(path, 'condition'),
      consumerKey,
      resolver,
      collector,
      environment,
    );
    return;
  }
  const selectorPath = appendJsonPointer(path, 'selector');
  const schema = resolver.selector(condition.selector, selectorPath, consumerKey, environment);
  if (schema !== null && condition.kind !== 'exists') {
    validateChoiceDomains(schema, [condition], path, collector);
  }
};
