import { PIPELINE_LIMITS, type ValueSchema } from '../../foundation/index.js';

const rootWeightLimit = PIPELINE_LIMITS.portableValue.visitedValues;

const addWeight = (left: number, right: number): number => Math.min(rootWeightLimit, left + right);

const multiplyWeight = (left: number, right: number): number =>
  Math.min(rootWeightLimit, left * right);

export const valueSchemaWeight = (schema: ValueSchema): number => {
  if ('anyOf' in schema) {
    return Math.max(...schema.anyOf.map(valueSchemaWeight));
  }
  if (schema.type === 'array') {
    const items = Math.min(
      schema.maxItems ?? PIPELINE_LIMITS.portableValue.arrayItems,
      PIPELINE_LIMITS.portableValue.arrayItems,
    );
    return addWeight(1, multiplyWeight(items, valueSchemaWeight(schema.items)));
  }
  if (schema.type === 'object') {
    return Object.values(schema.properties).reduce(
      (total, property) => addWeight(total, valueSchemaWeight(property)),
      1,
    );
  }
  return 1;
};
