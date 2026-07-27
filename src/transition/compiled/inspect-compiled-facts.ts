import { compareUnicodeCodePoints, isValidKey } from '../../policy/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const schema = (faults: CompiledInspectionFaultCollector, path: string, message: string): void =>
  faults.add({ code: 'DECODE_SCHEMA', path, message });

export const inspectCompiledFacts = (
  facts: readonly unknown[],
  faults: CompiledInspectionFaultCollector,
): {
  readonly complete: boolean;
  readonly keys: ReadonlySet<string>;
  readonly types: ReadonlyMap<string, string>;
} => {
  let complete = true;
  const keys = new Set<string>();
  const types = new Map<string, string>();
  let previous: string | undefined;
  facts.forEach((fact, index) => {
    const path = `/facts/${index}`;
    if (!isRecord(fact)) {
      schema(faults, path, 'Compiled fact must be an object.');
      complete = false;
      return;
    }
    const fields = Object.keys(fact);
    if (fields.length !== 2 || !fields.includes('key') || !fields.includes('type')) {
      schema(faults, path, 'Compiled fact fields are invalid.');
      complete = false;
      return;
    }
    const key = fact['key'];
    if (!isValidKey(key)) {
      schema(faults, `${path}/key`, 'Compiled fact key is invalid.');
      complete = false;
    } else if (keys.has(key)) {
      faults.add({
        code: 'DECODE_REFERENCE',
        path: `${path}/key`,
        message: 'Compiled fact key is duplicated.',
      });
      types.delete(key);
    } else if (
      typeof fact['type'] === 'string' &&
      ['boolean', 'null', 'number', 'string'].includes(fact['type'])
    ) {
      keys.add(key);
      types.set(key, fact['type']);
      if (previous !== undefined && compareUnicodeCodePoints(previous, key) > 0) {
        faults.add({
          code: 'DECODE_CANONICAL',
          path,
          message: 'Compiled facts are not in canonical order.',
        });
      }
      previous = key;
    } else {
      keys.add(key);
    }
    if (!['boolean', 'null', 'number', 'string'].includes(String(fact['type']))) {
      schema(faults, `${path}/type`, 'Compiled fact type is invalid.');
    }
  });
  return { complete, keys, types };
};
