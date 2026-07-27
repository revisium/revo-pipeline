import { compareUnicodeCodePoints, isValidKey } from '../../policy/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const reference = (
  condition: boolean,
  path: string,
  message: string,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!condition) {
    faults.add({ code: 'DECODE_REFERENCE', path, message });
  }
};

const schema = (path: string, message: string, faults: CompiledInspectionFaultCollector): void =>
  faults.add({ code: 'DECODE_SCHEMA', path, message });

const inspectEdgeIndex = (
  value: unknown,
  path: '/incomingIndex' | '/outgoingIndex',
  nodeKeys: ReadonlySet<string> | undefined,
  edgeCount: number | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!Array.isArray(value)) {
    return;
  }
  let previous: string | undefined;
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      schema(`${path}/${index}`, 'Compiled edge index entry must be an object.', faults);
      return;
    }
    const fields = Object.keys(entry);
    if (fields.length !== 2 || !fields.includes('edges') || !fields.includes('key')) {
      schema(`${path}/${index}`, 'Compiled edge index entry fields are invalid.', faults);
      return;
    }
    if (!isValidKey(entry['key'])) {
      schema(`${path}/${index}/key`, 'Compiled edge index key is invalid.', faults);
    } else {
      const key = entry['key'];
      if (seen.has(key)) {
        faults.add({
          code: 'DECODE_REFERENCE',
          path: `${path}/${index}/key`,
          message: 'Compiled edge index key is duplicated.',
        });
      } else if (previous !== undefined && compareUnicodeCodePoints(previous, key) > 0) {
        faults.add({
          code: 'DECODE_CANONICAL',
          path: `${path}/${index}`,
          message: 'Compiled edge index keys are not in canonical order.',
        });
      } else if (nodeKeys !== undefined) {
        reference(
          nodeKeys.has(key),
          `${path}/${index}/key`,
          'Compiled edge index key does not reference a node.',
          faults,
        );
      }
      seen.add(key);
      previous = key;
    }
    if (!Array.isArray(entry['edges'])) {
      schema(`${path}/${index}/edges`, 'Compiled edge index offsets must be an array.', faults);
      return;
    }
    entry['edges'].forEach((offset, edgeIndex) => {
      if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) {
        schema(
          `${path}/${index}/edges/${edgeIndex}`,
          'Compiled edge index offset must be a nonnegative safe integer.',
          faults,
        );
        return;
      }
      if (edgeCount !== undefined) {
        reference(
          offset < edgeCount,
          `${path}/${index}/edges/${edgeIndex}`,
          'Compiled edge index offset does not reference an edge.',
          faults,
        );
      }
    });
  });
};

export const inspectCompiledIndexes = (
  value: Record<string, unknown>,
  nodeKeys: ReadonlySet<string> | undefined,
  edgeCount: number | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  const nodeIndex = value['nodeIndex'];
  if (Array.isArray(nodeIndex)) {
    let previous: string | undefined;
    const seen = new Set<string>();
    nodeIndex.forEach((entry, index) => {
      if (!isRecord(entry)) {
        schema(`/nodeIndex/${index}`, 'Compiled node index entry must be an object.', faults);
        return;
      }
      const fields = Object.keys(entry);
      if (fields.length !== 2 || !fields.includes('key') || !fields.includes('node')) {
        schema(`/nodeIndex/${index}`, 'Compiled node index entry fields are invalid.', faults);
        return;
      }
      if (!isValidKey(entry['key'])) {
        schema(`/nodeIndex/${index}/key`, 'Compiled node index key is invalid.', faults);
      } else {
        const key = entry['key'];
        if (seen.has(key)) {
          faults.add({
            code: 'DECODE_REFERENCE',
            path: `/nodeIndex/${index}/key`,
            message: 'Compiled node index key is duplicated.',
          });
        } else if (previous !== undefined && compareUnicodeCodePoints(previous, key) > 0) {
          faults.add({
            code: 'DECODE_CANONICAL',
            path: `/nodeIndex/${index}`,
            message: 'Compiled node index keys are not in canonical order.',
          });
        } else if (nodeKeys !== undefined) {
          reference(
            nodeKeys.has(key),
            `/nodeIndex/${index}/key`,
            'Compiled node index key does not reference a node.',
            faults,
          );
        }
        seen.add(key);
        previous = key;
      }
      const nodeOffset = entry['node'];
      if (typeof nodeOffset !== 'number' || !Number.isSafeInteger(nodeOffset) || nodeOffset < 0) {
        schema(
          `/nodeIndex/${index}/node`,
          'Compiled node index offset must be a nonnegative safe integer.',
          faults,
        );
      } else if (nodeKeys !== undefined) {
        reference(
          nodeOffset < nodeKeys.size,
          `/nodeIndex/${index}/node`,
          'Compiled node index offset does not reference a node.',
          faults,
        );
      }
    });
  }
  inspectEdgeIndex(value['incomingIndex'], '/incomingIndex', nodeKeys, edgeCount, faults);
  inspectEdgeIndex(value['outgoingIndex'], '/outgoingIndex', nodeKeys, edgeCount, faults);
};
