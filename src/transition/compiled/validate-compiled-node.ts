import {
  compareUnicodeCodePoints,
  isValidKey,
  isValidSemanticName,
  PIPELINE_LIMITS,
} from '../../policy/index.js';
import type { FactDefinition } from '../../spec/index.js';
import { validateCompiledBranch } from './validate-compiled-branch.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const keys = Object.keys(value).sort(compareUnicodeCodePoints);
  const expected = [...fields].sort(compareUnicodeCodePoints);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');

const isCanonicalDisplayString = (value: unknown): value is string =>
  typeof value === 'string' &&
  value === value.normalize('NFC') &&
  Array.from(value).length <= PIPELINE_LIMITS.portable.displayCodePoints;

const isCanonicalStringArray = (values: readonly string[]): boolean =>
  values.every(
    (value, index) => index === 0 || compareUnicodeCodePoints(values[index - 1] ?? '', value) < 0,
  );

const hasCanonicalRecordNames = (values: readonly unknown[], field: string): boolean => {
  let previous: string | undefined;
  for (const value of values) {
    if (!isRecord(value) || typeof value[field] !== 'string') {
      return false;
    }
    const current = value[field];
    if (previous !== undefined && compareUnicodeCodePoints(previous, current) >= 0) {
      return false;
    }
    previous = current;
  }
  return true;
};

const validateTask = (value: Record<string, unknown>): boolean =>
  hasExactFields(value, ['key', 'kind', 'outcomes']) &&
  isStringRecord(value.outcomes) &&
  hasExactFields(value.outcomes, ['cancelled', 'completed', 'failed', 'skipped']) &&
  Object.values(value.outcomes).every(isValidKey);

const validateTerminal = (value: Record<string, unknown>): boolean =>
  hasExactFields(value, ['key', 'kind', 'outcome']) && isCanonicalDisplayString(value.outcome);

const validateFork = (value: Record<string, unknown>): boolean =>
  hasExactFields(value, ['branches', 'join', 'key', 'kind']) &&
  isValidKey(value.join) &&
  Array.isArray(value.branches) &&
  value.branches.length >= 2 &&
  value.branches.length <= PIPELINE_LIMITS.definition.forkBranchesPerNode &&
  value.branches.every(
    (branch) =>
      isRecord(branch) &&
      hasExactFields(branch, ['entry', 'exit', 'name']) &&
      isValidSemanticName(branch.name) &&
      isValidKey(branch.entry) &&
      isValidKey(branch.exit),
  ) &&
  hasCanonicalRecordNames(value.branches, 'name');

const validateJoin = (value: Record<string, unknown>): boolean =>
  hasExactFields(value, ['fork', 'key', 'kind', 'outcomes', 'policy']) &&
  isValidKey(value.fork) &&
  isRecord(value.outcomes) &&
  hasExactFields(value.outcomes, ['completed', 'insufficient', 'rejected']) &&
  Object.values(value.outcomes).every(isValidKey) &&
  isRecord(value.policy) &&
  ((value.policy.kind === 'all' && hasExactFields(value.policy, ['kind'])) ||
    (value.policy.kind === 'any' &&
      hasExactFields(value.policy, ['kind', 'remaining']) &&
      value.policy.remaining === 'unconstrained') ||
    (value.policy.kind === 'threshold' &&
      hasExactFields(value.policy, ['count', 'kind']) &&
      typeof value.policy.count === 'number' &&
      Number.isSafeInteger(value.policy.count) &&
      value.policy.count >= 1));

const validateConsensus = (value: Record<string, unknown>): boolean =>
  hasExactFields(value, ['candidates', 'key', 'kind', 'outcomes', 'policy']) &&
  Array.isArray(value.candidates) &&
  value.candidates.length >= 1 &&
  value.candidates.length <= PIPELINE_LIMITS.definition.candidatesPerNode &&
  value.candidates.every(isValidSemanticName) &&
  isCanonicalStringArray(value.candidates) &&
  isRecord(value.outcomes) &&
  hasExactFields(value.outcomes, ['approved', 'insufficient', 'rejected', 'tied']) &&
  Object.values(value.outcomes).every(isValidKey) &&
  isRecord(value.policy) &&
  ((value.policy.kind === 'unanimous' && hasExactFields(value.policy, ['kind'])) ||
    (value.policy.kind === 'quorum' &&
      hasExactFields(value.policy, ['kind', 'quorum']) &&
      typeof value.policy.quorum === 'number' &&
      Number.isSafeInteger(value.policy.quorum) &&
      value.policy.quorum >= 1 &&
      value.policy.quorum <= value.candidates.length) ||
    (value.policy.kind === 'threshold' &&
      hasExactFields(value.policy, ['approve', 'kind', 'reject']) &&
      typeof value.policy.approve === 'number' &&
      typeof value.policy.reject === 'number' &&
      Number.isSafeInteger(value.policy.approve) &&
      Number.isSafeInteger(value.policy.reject) &&
      value.policy.approve >= 1 &&
      value.policy.reject >= 1 &&
      value.policy.approve <= value.candidates.length &&
      value.policy.reject <= value.candidates.length &&
      value.policy.approve + value.policy.reject > value.candidates.length));

const validateHumanGate = (value: Record<string, unknown>): boolean =>
  hasExactFields(value, ['key', 'kind', 'resolutions', 'subject']) &&
  isCanonicalDisplayString(value.subject) &&
  Array.isArray(value.resolutions) &&
  value.resolutions.length >= 1 &&
  value.resolutions.length <= PIPELINE_LIMITS.definition.resolutionsPerNode &&
  value.resolutions.every(
    (route) =>
      isRecord(route) &&
      hasExactFields(route, ['resolution', 'to']) &&
      isValidSemanticName(route.resolution) &&
      isValidKey(route.to),
  ) &&
  hasCanonicalRecordNames(value.resolutions, 'resolution');

export const validateCompiledNode = (
  value: unknown,
  facts: ReadonlyMap<string, FactDefinition['type']>,
): boolean => {
  if (!isRecord(value) || !isValidKey(value.key) || typeof value.kind !== 'string') {
    return false;
  }
  if (value.kind === 'task') {
    return validateTask(value);
  }
  if (value.kind === 'terminal') {
    return validateTerminal(value);
  }
  if (value.kind === 'fork') {
    return validateFork(value);
  }
  if (value.kind === 'join') {
    return validateJoin(value);
  }
  if (value.kind === 'consensus') {
    return validateConsensus(value);
  }
  if (value.kind === 'humanGate') {
    return validateHumanGate(value);
  }
  return value.kind === 'branch' && validateCompiledBranch(value, facts);
};
