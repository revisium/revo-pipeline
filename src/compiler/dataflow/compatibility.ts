import { valueSchemaIsCompatible, type ValueSchema } from '../../foundation/index.js';
import type { ValueMapping } from '../../source/index.js';

export { valueSchemaIsCompatible };

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
