import { compareUnicodeCodePoints, isValidKey } from '../../policy/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const escaped = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');

export const inspectCompiledOutcomes = (
  outcomes: unknown,
  path: string,
  expectedNames: readonly string[],
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!isRecord(outcomes)) {
    faults.add({
      code: 'DECODE_SCHEMA',
      path,
      message: 'Compiled node outcomes must be an object.',
    });
    return;
  }
  const expected: ReadonlySet<string> = new Set(expectedNames);
  const names = Object.keys(outcomes).sort(compareUnicodeCodePoints);
  expectedNames.forEach((name) => {
    if (!names.includes(name)) {
      faults.add({
        code: 'DECODE_SCHEMA',
        path: `${path}/${name}`,
        message: 'Required compiled outcome is missing.',
      });
    }
  });
  names.forEach((name) => {
    const memberPath = `${path}/${escaped(name)}`;
    if (!expected.has(name)) {
      faults.add({
        code: 'DECODE_SCHEMA',
        path: memberPath,
        message: 'Compiled outcome is not allowed.',
      });
      return;
    }
    const target = outcomes[name];
    if (!isValidKey(target)) {
      faults.add({
        code: 'DECODE_SCHEMA',
        path: memberPath,
        message: 'Compiled node target is invalid.',
      });
    } else if (nodeKeys !== undefined && !nodeKeys.has(target)) {
      faults.add({
        code: 'DECODE_REFERENCE',
        path: memberPath,
        message: 'Compiled node target does not reference a node.',
      });
    }
  });
};
