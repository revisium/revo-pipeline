import type { ChoiceDomain, ValueSchema } from './contracts.js';
import { scalarKey } from './normalization.js';

type NumericInterval = readonly [minimum: number, maximum: number];

export type FiniteDomain = {
  readonly scalarKeys: ReadonlySet<string>;
  readonly numericIntervals: readonly NumericInterval[];
};

const mergeIntervals = (intervals: readonly NumericInterval[]): readonly NumericInterval[] => {
  const ordered = [...intervals].sort(
    ([leftMinimum, leftMaximum], [rightMinimum, rightMaximum]) =>
      leftMinimum - rightMinimum || leftMaximum - rightMaximum,
  );
  const merged: NumericInterval[] = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (previous === undefined || interval[0] > previous[1] + 1) {
      merged.push(interval);
    } else {
      merged[merged.length - 1] = [previous[0], Math.max(previous[1], interval[1])];
    }
  }
  return Object.freeze(merged);
};

export const finiteDomainOf = (schema: ValueSchema): FiniteDomain | null => {
  if ('anyOf' in schema) {
    const domains = schema.anyOf.map(finiteDomainOf);
    if (domains.includes(null)) {
      return null;
    }
    return Object.freeze({
      scalarKeys: new Set(domains.flatMap((domain) => [...(domain?.scalarKeys ?? [])])),
      numericIntervals: mergeIntervals(domains.flatMap((domain) => domain?.numericIntervals ?? [])),
    });
  }
  switch (schema.type) {
    case 'null':
      return Object.freeze({ scalarKeys: new Set(['null']), numericIntervals: [] });
    case 'boolean':
      return Object.freeze({
        scalarKeys: new Set([scalarKey(false), scalarKey(true)]),
        numericIntervals: [],
      });
    case 'string':
      return schema.enum === undefined
        ? null
        : Object.freeze({ scalarKeys: new Set(schema.enum.map(scalarKey)), numericIntervals: [] });
    case 'integer':
    case 'number':
      return schema.minimum === undefined || schema.maximum === undefined
        ? null
        : Object.freeze({
            scalarKeys: new Set<string>(),
            numericIntervals: [[schema.minimum, schema.maximum]],
          });
    case 'array':
    case 'object':
      return null;
  }
  throw new TypeError('Unexpected schema-validated value schema.');
};

export const casesCoverFiniteDomain = (
  schema: ValueSchema,
  domains: readonly ChoiceDomain[],
): boolean => {
  const finite = finiteDomainOf(schema);
  if (finite === null) {
    return false;
  }
  const values = domains.flatMap((domain) =>
    domain.kind === 'equals' ? [domain.value] : [...domain.values],
  );
  const scalarValues = new Set(values.filter((value) => typeof value !== 'number').map(scalarKey));
  if (
    scalarValues.size !== finite.scalarKeys.size ||
    [...scalarValues].some((value) => !finite.scalarKeys.has(value))
  ) {
    return false;
  }
  const numericValues = new Set(
    values.filter((value): value is number => typeof value === 'number'),
  );
  const expectedCount = finite.numericIntervals.reduce(
    (sum, [minimum, maximum]) => sum + maximum - minimum + 1,
    0,
  );
  return (
    numericValues.size === expectedCount &&
    [...numericValues].every((value) =>
      finite.numericIntervals.some(([minimum, maximum]) => value >= minimum && value <= maximum),
    )
  );
};
