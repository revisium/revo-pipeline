import {
  compareUnicodeCodePoints,
  isValidKey,
  isValidSemanticName,
  PIPELINE_LIMITS,
} from '../../policy/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';
import { inspectCompiledBranchFallback } from './inspect-compiled-branch-fallback.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const scalarType = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  return typeof value;
};

const schema = (path: string, message: string, faults: CompiledInspectionFaultCollector): void =>
  faults.add({ code: 'DECODE_SCHEMA', path, message });

const predicateValues = (value: Record<string, unknown>): readonly unknown[] | undefined => {
  if (Object.keys(value).length !== 2) {
    return undefined;
  }
  if (value['op'] === 'equals') {
    return 'value' in value ? [value['value']] : undefined;
  }
  return Array.isArray(value['values']) ? value['values'] : undefined;
};

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
  const values = predicateValues(value);
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
  return values;
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

interface CaseInspectionState {
  readonly domains: Set<string>;
  readonly names: Set<string>;
  previousName: string | undefined;
}

const inspectCaseOrder = (
  name: unknown,
  to: unknown,
  casePath: string,
  state: CaseInspectionState,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (typeof name !== 'string' || typeof to !== 'string') {
    return;
  }
  if (state.names.has(name)) {
    faults.add({
      code: 'DECODE_REFERENCE',
      path: `${casePath}/name`,
      message: 'Compiled branch case name is duplicated.',
    });
  } else if (
    state.previousName !== undefined &&
    compareUnicodeCodePoints(state.previousName, name) > 0
  ) {
    faults.add({
      code: 'DECODE_CANONICAL',
      path: casePath,
      message: 'Compiled branch cases are not in canonical order.',
    });
  }
  state.names.add(name);
  state.previousName = name;
};

const inspectCaseValues = (
  entry: Record<string, unknown>,
  factType: string | undefined,
  whenPath: string,
  state: CaseInspectionState,
  faults: CompiledInspectionFaultCollector,
): void => {
  const values = inspectWhen(entry['when'], factType, whenPath, faults);
  if (!values) {
    return;
  }
  const identities = values.map(identity);
  if (
    new Set(identities).size !== identities.length ||
    identities.some((domain) => state.domains.has(domain))
  ) {
    schema(whenPath, 'Compiled branch predicate domains must be disjoint.', faults);
  }
  const exceedsLimit = values.length > PIPELINE_LIMITS.definition.predicateValuesPerCase;
  const unordered =
    isRecord(entry['when']) &&
    entry['when']['op'] === 'oneOf' &&
    values.some(
      (value, valueIndex) => valueIndex > 0 && scalarCompare(values[valueIndex - 1], value) > 0,
    );
  if (exceedsLimit || unordered) {
    faults.add({
      code: exceedsLimit ? 'DECODE_LIMIT' : 'DECODE_CANONICAL',
      path: whenPath,
      message: 'Compiled branch predicate values are not canonical.',
    });
  }
  identities.forEach((domain) => state.domains.add(domain));
};

const inspectCase = (
  entry: unknown,
  index: number,
  factType: string | undefined,
  path: string,
  state: CaseInspectionState,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!isRecord(entry)) {
    return;
  }
  const casePath = `${path}/cases/${index}`;
  const name = entry['name'];
  const to = entry['to'];
  if (!isValidSemanticName(name)) {
    schema(`${casePath}/name`, 'Compiled branch case name is invalid.', faults);
  }
  if (!isValidKey(to)) {
    schema(`${casePath}/to`, 'Compiled branch case target is invalid.', faults);
  }
  inspectCaseOrder(name, to, casePath, state, faults);
  inspectCaseValues(entry, factType, `${casePath}/when`, state, faults);
};

const inspectCases = (
  cases: readonly unknown[],
  factType: string | undefined,
  path: string,
  faults: CompiledInspectionFaultCollector,
): { readonly domains: ReadonlySet<string>; readonly names: ReadonlySet<string> } => {
  const state: CaseInspectionState = {
    domains: new Set<string>(),
    names: new Set<string>(),
    previousName: undefined,
  };
  cases.forEach((entry, index) => inspectCase(entry, index, factType, path, state, faults));
  return state;
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
  inspectCompiledBranchFallback(node['default'], names, factType, domains, path, faults);
};
