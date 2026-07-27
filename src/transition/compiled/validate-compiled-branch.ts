import {
  compareUnicodeCodePoints,
  isValidKey,
  isValidSemanticName,
  PIPELINE_LIMITS,
} from '../../policy/index.js';
import type { FactDefinition, JsonScalar, PipelineNode } from '../../spec/index.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const keys = Object.keys(value).sort(compareUnicodeCodePoints);
  const expected = [...fields].sort(compareUnicodeCodePoints);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

const isJsonScalar = (value: unknown): value is JsonScalar =>
  value === null ||
  typeof value === 'boolean' ||
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isSafeInteger(value));

const scalarType = (value: JsonScalar): FactDefinition['type'] => {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  return typeof value === 'number' ? 'number' : 'string';
};

const scalarComparator = (left: JsonScalar, right: JsonScalar): number => {
  const ranks = { null: 0, boolean: 1, number: 2, string: 3 } as const;
  const leftType = scalarType(left);
  const rightType = scalarType(right);
  if (leftType !== rightType) {
    return ranks[leftType] - ranks[rightType];
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

const scalarIdentity = (value: JsonScalar): string =>
  value === null ? 'null:' : `${typeof value}:${String(value)}`;

type BranchCase = Extract<PipelineNode, { readonly kind: 'branch' }>['cases'][number];

const caseOrderIsValid = (
  entry: BranchCase,
  previous: BranchCase | undefined,
  names: ReadonlySet<string>,
): boolean =>
  !names.has(entry.name) &&
  (previous === undefined ||
    compareUnicodeCodePoints(previous.name, entry.name) < 0 ||
    (previous.name === entry.name && compareUnicodeCodePoints(previous.to, entry.to) < 0));

const validatedCaseIdentities = (
  entry: BranchCase,
  factType: FactDefinition['type'],
  usedIdentities: ReadonlySet<string>,
): readonly string[] | undefined => {
  const values = entry.when.op === 'equals' ? [entry.when.value] : entry.when.values;
  const identities = values.map(scalarIdentity);
  const unordered =
    entry.when.op === 'oneOf' &&
    values.some((value, index) => index > 0 && scalarComparator(values[index - 1]!, value) >= 0);
  return values.length === 0 ||
    values.length > PIPELINE_LIMITS.definition.predicateValuesPerCase ||
    values.some((value) => scalarType(value) !== factType) ||
    new Set(identities).size !== identities.length ||
    identities.some((identity) => usedIdentities.has(identity)) ||
    unordered
    ? undefined
    : identities;
};

const hasBranchShape = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & Extract<PipelineNode, { readonly kind: 'branch' }> =>
  value.kind === 'branch' &&
  hasExactFields(value, ['cases', 'default', 'fact', 'key', 'kind']) &&
  isValidKey(value.fact) &&
  Array.isArray(value.cases) &&
  (value.default === null ||
    (isRecord(value.default) &&
      hasExactFields(value.default, ['name', 'to']) &&
      isValidSemanticName(value.default.name) &&
      isValidKey(value.default.to))) &&
  value.cases.every(
    (entry) =>
      isRecord(entry) &&
      hasExactFields(entry, ['name', 'to', 'when']) &&
      isValidSemanticName(entry.name) &&
      isValidKey(entry.to) &&
      isRecord(entry.when) &&
      ((entry.when.op === 'equals' &&
        hasExactFields(entry.when, ['op', 'value']) &&
        isJsonScalar(entry.when.value)) ||
        (entry.when.op === 'oneOf' &&
          hasExactFields(entry.when, ['op', 'values']) &&
          Array.isArray(entry.when.values) &&
          entry.when.values.every(isJsonScalar))),
  );

const hasBranchIntegrity = (
  node: Extract<PipelineNode, { readonly kind: 'branch' }>,
  facts: ReadonlyMap<string, FactDefinition['type']>,
): boolean => {
  const factType = facts.get(node.fact);
  if (factType === undefined || node.cases.length > PIPELINE_LIMITS.definition.branchCasesPerNode) {
    return false;
  }
  const domains: JsonScalar[] = [];
  const domainIdentities = new Set<string>();
  const names = new Set<string>();
  let previous: (typeof node.cases)[number] | undefined;
  for (const entry of node.cases) {
    if (!caseOrderIsValid(entry, previous, names)) {
      return false;
    }
    names.add(entry.name);
    previous = entry;
    const values = entry.when.op === 'equals' ? [entry.when.value] : entry.when.values;
    const identities = validatedCaseIdentities(entry, factType, domainIdentities);
    if (identities === undefined) {
      return false;
    }
    domains.push(...values);
    identities.forEach((identity) => domainIdentities.add(identity));
  }
  if (node.default !== null && names.has(node.default.name)) {
    return false;
  }
  const fullyCovered =
    (factType === 'null' && domains.includes(null)) ||
    (factType === 'boolean' && domains.includes(true) && domains.includes(false));
  return fullyCovered ? node.default === null : node.default !== null;
};

export const validateCompiledBranch = (
  value: Record<string, unknown>,
  facts: ReadonlyMap<string, FactDefinition['type']>,
): boolean => hasBranchShape(value) && hasBranchIntegrity(value, facts);
