import { valueSchemasEqual, type ValueSchema } from '../../foundation/index.js';
import type { ValueMapping } from '../../source/index.js';

type IntegerSchema = Extract<ValueSchema, { readonly type: 'integer' }>;
type NumberSchema = Extract<ValueSchema, { readonly type: 'number' }>;

const lowerBoundFits = (producer: IntegerSchema, consumer: NumberSchema): boolean =>
  consumer.minimum === undefined ||
  (producer.minimum !== undefined && producer.minimum >= consumer.minimum);

const upperBoundFits = (producer: IntegerSchema, consumer: NumberSchema): boolean =>
  consumer.maximum === undefined ||
  (producer.maximum !== undefined && producer.maximum <= consumer.maximum);

export const valueSchemaIsCompatible = (producer: ValueSchema, consumer: ValueSchema): boolean => {
  if (valueSchemasEqual(producer, consumer)) {
    return true;
  }
  return (
    'type' in producer &&
    'type' in consumer &&
    producer.type === 'integer' &&
    consumer.type === 'number' &&
    lowerBoundFits(producer, consumer) &&
    upperBoundFits(producer, consumer)
  );
};

export const mappingShapeMatches = (mapping: ValueMapping, target: ValueSchema): boolean => {
  if (!('type' in target) || target.type !== 'object') {
    return false;
  }
  const keys = Object.keys(mapping);
  return (
    keys.every((key) => Object.hasOwn(target.properties, key)) &&
    target.required.every((key) => Object.hasOwn(mapping, key))
  );
};
