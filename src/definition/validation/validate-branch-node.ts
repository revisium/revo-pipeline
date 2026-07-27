import { jsonScalarsEqual, normalizeJsonScalar, PIPELINE_LIMITS } from '../../policy/index.js';
import type { FactDefinition, JsonScalar } from '../../spec/index.js';
import type { DefinitionValidationContext } from './definition-validation-context.js';

type RecordValue = Record<string, unknown>;

const scalarType = (value: JsonScalar): string => (value === null ? 'null' : typeof value);

const validateScalar = (
  value: unknown,
  path: string,
  context: DefinitionValidationContext,
): value is JsonScalar => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  ) {
    return true;
  }
  context.addFault('DEF_TYPE', path, 'Expected a JSON scalar.');
  return false;
};

const validatePredicate = (
  value: unknown,
  path: string,
  context: DefinitionValidationContext,
): readonly JsonScalar[] => {
  if (!context.isRecord(value) || (value.op !== 'equals' && value.op !== 'oneOf')) {
    context.addFault('DEF_TYPE', path, 'Invalid branch predicate.');
    return [];
  }
  if (value.op === 'equals') {
    context.unknownFields(value, ['op', 'value'], path);
    return validateScalar(value.value, `${path}/value`, context)
      ? [normalizeJsonScalar(value.value)]
      : [];
  }
  context.unknownFields(value, ['op', 'values'], path);
  if (
    !context.requireArray(
      value.values,
      `${path}/values`,
      PIPELINE_LIMITS.definition.predicateValuesPerCase,
    )
  ) {
    return [];
  }
  if (value.values.length === 0) {
    context.addFault('DEF_BRANCH_NON_EXHAUSTIVE', `${path}/values`, 'oneOf must be non-empty.');
  }
  const scalars: JsonScalar[] = [];
  value.values.forEach((entry, index) => {
    if (validateScalar(entry, `${path}/values/${index}`, context)) {
      const normalized = normalizeJsonScalar(entry);
      if (scalars.some((existing) => jsonScalarsEqual(existing, normalized))) {
        context.addFault('DEF_DUPLICATE', `${path}/values/${index}`, 'Duplicate predicate value.');
      }
      scalars.push(normalized);
    }
  });
  return scalars;
};

const validateCase = (
  entry: RecordValue,
  path: string,
  expectedType: FactDefinition['type'] | undefined,
  domains: JsonScalar[],
  names: Set<string>,
  context: DefinitionValidationContext,
): void => {
  context.unknownFields(entry, ['name', 'to', 'when'], path);
  if (context.requireName(entry.name, `${path}/name`)) {
    if (names.has(entry.name)) {
      context.addFault('DEF_DUPLICATE', `${path}/name`, 'Duplicate branch name.');
    }
    names.add(entry.name);
  }
  context.requireKey(entry.to, `${path}/to`);
  for (const scalar of validatePredicate(entry.when, `${path}/when`, context)) {
    if (domains.some((existing) => jsonScalarsEqual(existing, scalar))) {
      context.addFault('DEF_BRANCH_AMBIGUOUS', `${path}/when`, 'Overlapping case domain.');
    }
    domains.push(scalar);
    if (expectedType !== undefined && scalarType(scalar) !== expectedType) {
      context.addFault('DEF_TYPE', `${path}/when`, 'Predicate type differs from fact.');
    }
  }
};

const validateCases = (
  cases: readonly unknown[],
  path: string,
  expectedType: FactDefinition['type'] | undefined,
  context: DefinitionValidationContext,
): { readonly domains: readonly JsonScalar[]; readonly names: ReadonlySet<string> } => {
  const domains: JsonScalar[] = [];
  const names = new Set<string>();
  for (const [index, entry] of cases.entries()) {
    const casePath = `${path}/cases/${index}`;
    if (!context.isRecord(entry)) {
      context.addFault('DEF_TYPE', casePath, 'Expected branch case.');
      continue;
    }
    validateCase(entry, casePath, expectedType, domains, names, context);
  }
  return { domains, names };
};

const validateDefault = (
  value: unknown,
  path: string,
  caseNames: ReadonlySet<string>,
  context: DefinitionValidationContext,
): void => {
  if (value === null) {
    return;
  }
  if (!context.isRecord(value)) {
    context.addFault('DEF_TYPE', `${path}/default`, 'Invalid branch default.');
    return;
  }
  context.unknownFields(value, ['name', 'to'], `${path}/default`);
  const name = value.name;
  const nameValid = context.requireName(name, `${path}/default/name`);
  const targetValid = nameValid && context.requireKey(value.to, `${path}/default/to`);
  if (!nameValid || !targetValid) {
    context.addFault('DEF_TYPE', `${path}/default`, 'Invalid branch default.');
  }
  if (nameValid && caseNames.has(name)) {
    context.addFault('DEF_DUPLICATE', `${path}/default/name`, 'Duplicate branch name.');
  }
};

const domainIsFullyCovered = (
  type: FactDefinition['type'] | undefined,
  domains: readonly JsonScalar[],
): boolean => {
  if (type === 'null') {
    return domains.includes(null);
  }
  return type === 'boolean' && domains.includes(true) && domains.includes(false);
};

const validateCoverage = (
  type: FactDefinition['type'] | undefined,
  domains: readonly JsonScalar[],
  hasDefault: boolean,
  path: string,
  context: DefinitionValidationContext,
): void => {
  if ((type === 'string' || type === 'number') && !hasDefault) {
    context.addFault('DEF_BRANCH_NON_EXHAUSTIVE', `${path}/default`, 'Default is required.');
  }
  const fullyCovered = domainIsFullyCovered(type, domains);
  if ((type === 'null' || type === 'boolean') && !fullyCovered && !hasDefault) {
    context.addFault('DEF_BRANCH_NON_EXHAUSTIVE', `${path}/default`, 'Branch is not exhaustive.');
  }
  if (fullyCovered && hasDefault) {
    context.addFault(
      'DEF_BRANCH_UNREACHABLE_DEFAULT',
      `${path}/default`,
      'Default is unreachable.',
    );
  }
};

export const validateBranchNode = (
  node: RecordValue,
  path: string,
  factTypes: ReadonlyMap<string, FactDefinition['type']>,
  context: DefinitionValidationContext,
): void => {
  context.unknownFields(node, ['cases', 'default', 'fact', 'key', 'kind'], path);
  const fact = node.fact;
  const factValid = context.requireKey(fact, `${path}/fact`);
  const cases = context.requireArray(
    node.cases,
    `${path}/cases`,
    PIPELINE_LIMITS.definition.branchCasesPerNode,
  )
    ? node.cases
    : [];
  const type = factValid ? factTypes.get(fact) : undefined;
  const { domains, names } = validateCases(cases, path, type, context);
  validateDefault(node.default, path, names, context);
  if (factValid && type === undefined) {
    context.addFault('DEF_TARGET', `${path}/fact`, 'Unknown branch fact.');
  }
  validateCoverage(type, domains, node.default !== null, path, context);
};
