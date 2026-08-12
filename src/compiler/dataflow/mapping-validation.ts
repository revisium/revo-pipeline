import {
  appendJsonPointer,
  type DiagnosticCollector,
  type JsonPointer,
  type ValueSchema,
} from '../../foundation/index.js';
import type { ValueMapping } from '../../source/index.js';
import { mappingShapeMatches, valueSchemaIsCompatible } from './compatibility.js';
import type { SchemaResolver, SelectorEnvironment } from './schema-resolver.js';

export const validateMapping = (
  mapping: ValueMapping,
  target: ValueSchema,
  path: JsonPointer,
  consumerKey: string,
  resolver: SchemaResolver,
  collector: DiagnosticCollector,
  environment?: SelectorEnvironment,
): void => {
  if (!mappingShapeMatches(mapping, target)) {
    collector.add('DATA_SCHEMA_INCOMPATIBLE', path);
  }
  if (!('type' in target) || target.type !== 'object') {
    return;
  }
  for (const [key, selector] of Object.entries(mapping)) {
    const fieldPath = appendJsonPointer(path, key);
    const producer = resolver.selector(selector, fieldPath, consumerKey, environment);
    const consumer = target.properties[key];
    if (
      producer !== null &&
      consumer !== undefined &&
      !valueSchemaIsCompatible(producer, consumer)
    ) {
      collector.add('DATA_SCHEMA_INCOMPATIBLE', fieldPath);
    }
  }
};
