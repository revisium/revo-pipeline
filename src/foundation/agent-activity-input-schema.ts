import type { ValueSchema } from './value-schema/contracts.js';

const isStringFamily = (schema: ValueSchema): boolean =>
  'anyOf' in schema ? schema.anyOf.every(isStringFamily) : schema.type === 'string';

const isClosedObjectFamily = (schema: ValueSchema): boolean =>
  'anyOf' in schema
    ? schema.anyOf.every(isClosedObjectFamily)
    : schema.type === 'object' && !schema.additionalProperties;

/**
 * Checks the internal ValueSchema representation of an agent activity envelope.
 * The public runtime envelope is intentionally broader; each Program carries its
 * exact, closed metadata schema.
 */
export const isAgentActivityInputValueSchema = (schema: ValueSchema): boolean => {
  if ('anyOf' in schema || schema.type !== 'object' || schema.additionalProperties) {
    return false;
  }
  const prompt = schema.properties.prompt;
  const metadata = schema.properties.metadata;
  return (
    prompt !== undefined &&
    isStringFamily(prompt) &&
    schema.required.includes('prompt') &&
    Object.keys(schema.properties).every((key) => key === 'prompt' || key === 'metadata') &&
    (metadata === undefined || isClosedObjectFamily(metadata))
  );
};
