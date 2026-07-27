import {
  compareUnicodeCodePoints,
  isValidSemanticName,
  PIPELINE_LIMITS,
} from '../../policy/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const schema = (path: string, message: string, faults: CompiledInspectionFaultCollector): void =>
  faults.add({ code: 'DECODE_SCHEMA', path, message });

const exact = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(value).length === fields.length && fields.every((field) => field in value);

const positiveInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

const inspectJoinPolicy = (
  value: unknown,
  path: string,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!isRecord(value) || typeof value['kind'] !== 'string') {
    schema(path, 'Compiled join policy is invalid.', faults);
    return;
  }
  const valid =
    (value['kind'] === 'all' && exact(value, ['kind'])) ||
    (value['kind'] === 'any' &&
      exact(value, ['kind', 'remaining']) &&
      value['remaining'] === 'unconstrained') ||
    (value['kind'] === 'threshold' &&
      exact(value, ['count', 'kind']) &&
      positiveInteger(value['count']));
  if (!valid) {
    schema(path, 'Compiled join policy is invalid.', faults);
  }
};

const inspectConsensusPolicy = (
  value: unknown,
  candidateCount: number,
  path: string,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!isRecord(value) || typeof value['kind'] !== 'string') {
    schema(path, 'Compiled consensus policy is invalid.', faults);
    return;
  }
  const valid =
    (value['kind'] === 'unanimous' && exact(value, ['kind'])) ||
    (value['kind'] === 'quorum' &&
      exact(value, ['kind', 'quorum']) &&
      positiveInteger(value['quorum']) &&
      Number(value['quorum']) <= candidateCount) ||
    (value['kind'] === 'threshold' &&
      exact(value, ['approve', 'kind', 'reject']) &&
      positiveInteger(value['approve']) &&
      positiveInteger(value['reject']) &&
      Number(value['approve']) <= candidateCount &&
      Number(value['reject']) <= candidateCount &&
      Number(value['approve']) + Number(value['reject']) > candidateCount);
  if (!valid) {
    schema(path, 'Compiled consensus policy is invalid.', faults);
  }
};

export const inspectCompiledNodePolicy = (
  node: Record<string, unknown>,
  path: string,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (node['kind'] === 'join') {
    inspectJoinPolicy(node['policy'], `${path}/policy`, faults);
  }
  if (node['kind'] === 'consensus') {
    const candidates = node['candidates'];
    if (
      !Array.isArray(candidates) ||
      candidates.length === 0 ||
      candidates.length > PIPELINE_LIMITS.definition.candidatesPerNode ||
      candidates.some((candidate) => !isValidSemanticName(candidate))
    ) {
      schema(`${path}/candidates`, 'Compiled consensus candidates are invalid.', faults);
      return;
    }
    const names = candidates.filter(
      (candidate): candidate is string => typeof candidate === 'string',
    );
    const seen = new Set<string>();
    names.forEach((candidate, index) => {
      const previous = names[index - 1];
      if (seen.has(candidate)) {
        faults.add({
          code: 'DECODE_REFERENCE',
          path: `${path}/candidates/${index}`,
          message: 'Compiled consensus candidate is duplicated.',
        });
      } else if (
        typeof previous === 'string' &&
        compareUnicodeCodePoints(previous, candidate) > 0
      ) {
        faults.add({
          code: 'DECODE_CANONICAL',
          path: `${path}/candidates/${index}`,
          message: 'Compiled consensus candidates are not in canonical order.',
        });
      }
      seen.add(candidate);
    });
    inspectConsensusPolicy(node['policy'], candidates.length, `${path}/policy`, faults);
  }
};
