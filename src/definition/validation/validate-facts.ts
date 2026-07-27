import { PIPELINE_LIMITS } from '../../policy/index.js';
import type { FactDefinition } from '../../spec/index.js';
import type { DefinitionValidationContext } from './definition-validation-context.js';

const FACT_TYPES: ReadonlySet<string> = new Set(['boolean', 'null', 'number', 'string']);

const isFactType = (value: unknown): value is FactDefinition['type'] =>
  typeof value === 'string' && FACT_TYPES.has(value);

export const validateFacts = (
  value: unknown,
  context: DefinitionValidationContext,
): readonly FactDefinition[] => {
  if (!context.requireArray(value, '/facts', PIPELINE_LIMITS.definition.declaredFacts)) {
    return [];
  }
  const facts: FactDefinition[] = [];
  const keys = new Set<string>();
  value.forEach((entry, index) => {
    const path = `/facts/${index}`;
    if (!context.isRecord(entry)) {
      context.addFault('DEF_TYPE', path, 'Expected fact definition.');
      return;
    }
    context.unknownFields(entry, ['key', 'type'], path);
    const key = entry.key;
    const type = entry.type;
    const keyValid = context.requireKey(key, `${path}/key`);
    const typeValid = isFactType(type);
    if (!typeValid) {
      context.addFault('DEF_TYPE', `${path}/type`, 'Invalid fact type.');
    }
    if (keyValid && keys.has(key)) {
      context.addFault('DEF_DUPLICATE', `${path}/key`, 'Duplicate fact key.');
    }
    if (keyValid) {
      keys.add(key);
    }
    if (keyValid && typeValid) {
      facts.push({ key, type });
    }
  });
  return facts;
};
