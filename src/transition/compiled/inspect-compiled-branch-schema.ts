import {
  compareUnicodeCodePoints,
  isValidKey,
  isValidSemanticName,
  PIPELINE_LIMITS,
} from '../../policy/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const scalarType = (value: unknown): string =>
  value === null ? 'null' : typeof value === 'boolean' ? 'boolean' : typeof value;

const schema = (path: string, message: string, faults: CompiledInspectionFaultCollector): void =>
  faults.add({ code: 'DECODE_SCHEMA', path, message });

const inspectWhen = (
  value: unknown,
  factType: string | undefined,
  path: string,
  faults: CompiledInspectionFaultCollector,
): readonly unknown[] | undefined => {
  if (!isRecord(value) || (value['op'] !== 'equals' && value['op'] !== 'oneOf')) {
    schema(path, 'Compiled branch predicate is invalid.', faults);
    return undefined;
  }
  const values =
    value['op'] === 'equals'
      ? Object.keys(value).length === 2 && 'value' in value
        ? [value['value']]
        : undefined
      : Object.keys(value).length === 2 && Array.isArray(value['values'])
        ? value['values']
        : undefined;
  if (
    !values ||
    values.length === 0 ||
    values.some(
      (entry) => !['boolean', 'number', 'string'].includes(typeof entry) && entry !== null,
    ) ||
    (factType !== undefined && values.some((entry) => scalarType(entry) !== factType))
  ) {
    schema(path, 'Compiled branch predicate values are invalid.', faults);
    return undefined;
  }
  return values as readonly unknown[];
};

const identity = (value: unknown): string => {
  if (value === null) {
    return 'null:';
  }
  if (typeof value === 'string') {
    return `string:${value}`;
  }
  if (typeof value === 'number') {
    return `number:${value}`;
  }
  return `boolean:${value === true ? 'true' : 'false'}`;
};

const scalarCompare = (left: unknown, right: unknown): number => {
  const ranks: Readonly<Record<string, number>> = { null: 0, boolean: 1, number: 2, string: 3 };
  const leftType = scalarType(left);
  const rightType = scalarType(right);
  if (leftType !== rightType) {
    return (ranks[leftType] ?? 4) - (ranks[rightType] ?? 4);
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return typeof left === 'string' && typeof right === 'string'
    ? compareUnicodeCodePoints(left, right)
    : 0;
};

const inspectCases = (
  cases: readonly unknown[],
  factType: string | undefined,
  path: string,
  faults: CompiledInspectionFaultCollector,
): { readonly domains: ReadonlySet<string>; readonly names: ReadonlySet<string> } => {
  const domains = new Set<string>();
  const names = new Set<string>();
  let previousName: string | undefined;
  cases.forEach((entry, index) => {
    if (isRecord(entry)) {
      const casePath = `${path}/cases/${index}`;
      const name = entry['name'];
      const to = entry['to'];
      if (!isValidSemanticName(name)) {
        schema(`${casePath}/name`, 'Compiled branch case name is invalid.', faults);
      }
      if (!isValidKey(to)) {
        schema(`${casePath}/to`, 'Compiled branch case target is invalid.', faults);
      }
      if (typeof name === 'string' && typeof to === 'string') {
        if (names.has(name)) {
          faults.add({
            code: 'DECODE_REFERENCE',
            path: `${casePath}/name`,
            message: 'Compiled branch case name is duplicated.',
          });
        } else if (previousName !== undefined && compareUnicodeCodePoints(previousName, name) > 0) {
          faults.add({
            code: 'DECODE_CANONICAL',
            path: casePath,
            message: 'Compiled branch cases are not in canonical order.',
          });
        }
        names.add(name);
        previousName = name;
      }
      const whenPath = `${path}/cases/${index}/when`;
      const values = inspectWhen(entry['when'], factType, whenPath, faults);
      if (values) {
        const identities = values.map(identity);
        if (
          new Set(identities).size !== identities.length ||
          identities.some((domain) => domains.has(domain))
        ) {
          schema(whenPath, 'Compiled branch predicate domains must be disjoint.', faults);
        }
        if (
          values.length > PIPELINE_LIMITS.definition.predicateValuesPerCase ||
          (isRecord(entry['when']) &&
            entry['when']['op'] === 'oneOf' &&
            values.some(
              (value, valueIndex) =>
                valueIndex > 0 && scalarCompare(values[valueIndex - 1], value) > 0,
            ))
        ) {
          faults.add({
            code:
              values.length > PIPELINE_LIMITS.definition.predicateValuesPerCase
                ? 'DECODE_LIMIT'
                : 'DECODE_CANONICAL',
            path: whenPath,
            message: 'Compiled branch predicate values are not canonical.',
          });
        }
        identities.forEach((domain) => domains.add(domain));
      }
    }
  });
  return { domains, names };
};

export const inspectCompiledBranchSchema = (
  node: Record<string, unknown>,
  path: string,
  factTypes: ReadonlyMap<string, string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  const fact = node['fact'];
  const factType = typeof fact === 'string' ? factTypes?.get(fact) : undefined;
  const cases = node['cases'];
  if (!Array.isArray(cases)) {
    schema(`${path}/cases`, 'Compiled branch cases must be an array.', faults);
    return;
  }
  if (cases.length > PIPELINE_LIMITS.definition.branchCasesPerNode) {
    faults.add({
      code: 'DECODE_LIMIT',
      path: `${path}/cases`,
      message: 'Compiled branch case count exceeds the supported limit.',
    });
  }
  const { domains, names } = inspectCases(cases, factType, path, faults);
  const fallback = node['default'];
  if (
    fallback !== null &&
    (!isRecord(fallback) ||
      Object.keys(fallback).length !== 2 ||
      !('name' in fallback) ||
      !('to' in fallback))
  ) {
    schema(`${path}/default`, 'Compiled branch default is invalid.', faults);
  } else if (isRecord(fallback)) {
    const fallbackName = fallback['name'];
    if (!isValidSemanticName(fallbackName) || names.has(fallbackName)) {
      schema(`${path}/default/name`, 'Compiled branch default name is invalid.', faults);
    }
    if (!isValidKey(fallback['to'])) {
      schema(`${path}/default/to`, 'Compiled branch default target is invalid.', faults);
    }
  }
  if (factType === 'null' || factType === 'boolean') {
    const fullyCovered =
      (factType === 'null' && domains.has('null:')) ||
      (factType === 'boolean' && domains.has('boolean:true') && domains.has('boolean:false'));
    if ((fullyCovered && fallback !== null) || (!fullyCovered && fallback === null)) {
      schema(
        `${path}/default`,
        'Compiled branch default does not match predicate coverage.',
        faults,
      );
    }
  }
};
