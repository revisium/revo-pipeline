import {
  appendJsonPointer,
  isIdentifier,
  type DiagnosticCollector,
  type JsonPointer,
} from '../foundation/index.js';

export const nonEmptyTuple = <Value>(values: readonly Value[]): readonly [Value, ...Value[]] => {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new TypeError('Expected a schema-validated non-empty array.');
  }
  return Object.freeze([first, ...rest]);
};

export const atLeastTwoTuple = <Value>(
  values: readonly Value[],
): readonly [Value, Value, ...Value[]] => {
  const [first, second, ...rest] = values;
  if (first === undefined || second === undefined) {
    throw new TypeError('Expected a schema-validated array with two values.');
  }
  return Object.freeze([first, second, ...rest]);
};

export const nestedPath = (path: JsonPointer, ...tokens: readonly string[]): JsonPointer =>
  tokens.reduce<JsonPointer>((current, token) => appendJsonPointer(current, token), path);

export const validateIdentifier = (
  value: string,
  path: JsonPointer,
  collector: DiagnosticCollector,
): void => {
  if (!isIdentifier(value)) {
    collector.add('CANONICAL_INPUT', path);
  }
};
