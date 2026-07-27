import { isValidKey } from '../../policy/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';

const ROOT_FIELDS = [
  'edges',
  'entry',
  'facts',
  'forkRegions',
  'incomingIndex',
  'nodeIndex',
  'nodes',
  'outgoingIndex',
  'schemaVersion',
  'topologicalOrder',
] as const;

const COLLECTION_FIELDS = [
  'edges',
  'facts',
  'forkRegions',
  'incomingIndex',
  'nodeIndex',
  'nodes',
  'outgoingIndex',
  'topologicalOrder',
] as const;

const ROOT_FIELD_SET: ReadonlySet<string> = new Set(ROOT_FIELDS);

const schema = (faults: CompiledInspectionFaultCollector, path: string, message: string): void =>
  faults.add({ code: 'DECODE_SCHEMA', path, message });

const inspectShape = (
  value: Record<string, unknown>,
  faults: CompiledInspectionFaultCollector,
): void => {
  const keys = new Set(Object.keys(value));
  ROOT_FIELDS.forEach((field) => {
    if (!keys.has(field)) {
      schema(faults, `/${field}`, 'Required compiled pipeline field is missing.');
    }
  });
  keys.forEach((key) => {
    if (!ROOT_FIELD_SET.has(key)) {
      schema(
        faults,
        `/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        'Compiled pipeline field is not allowed.',
      );
    }
  });
  if (keys.has('schemaVersion') && value['schemaVersion'] !== 1) {
    schema(faults, '/schemaVersion', 'Compiled pipeline schemaVersion must be 1.');
  }
  if (keys.has('entry') && typeof value['entry'] !== 'string') {
    schema(faults, '/entry', 'Compiled pipeline entry must be a string.');
  }
  COLLECTION_FIELDS.forEach((field) => {
    if (keys.has(field) && !Array.isArray(value[field])) {
      schema(faults, `/${field}`, 'Compiled pipeline field must be an array.');
    }
  });
};

const inspectTopology = (
  value: unknown,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!Array.isArray(value)) {
    return;
  }
  value.forEach((key, index) => {
    if (typeof key !== 'string') {
      schema(faults, `/topologicalOrder/${index}`, 'Compiled topology key must be a string.');
    } else if (nodeKeys !== undefined && !nodeKeys.has(key)) {
      faults.add({
        code: 'DECODE_REFERENCE',
        path: `/topologicalOrder/${index}`,
        message: 'Compiled topology key does not reference a node.',
      });
    }
  });
};

const inspectEntry = (
  entry: unknown,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (typeof entry !== 'string') {
    return;
  }
  if (!isValidKey(entry)) {
    schema(faults, '/entry', 'Compiled pipeline entry is invalid.');
  } else if (nodeKeys !== undefined && !nodeKeys.has(entry)) {
    faults.add({
      code: 'DECODE_REFERENCE',
      path: '/entry',
      message: 'Compiled pipeline entry does not reference a node.',
    });
  }
};

const inspectReferences = (
  value: Record<string, unknown>,
  nodeKeys: ReadonlySet<string>,
  faults: CompiledInspectionFaultCollector,
): void => {
  const topology = value['topologicalOrder'];
  if (Array.isArray(topology)) {
    topology.forEach((key, index) => {
      if (typeof key === 'string' && !nodeKeys.has(key)) {
        faults.add({
          code: 'DECODE_REFERENCE',
          path: `/topologicalOrder/${index}`,
          message: 'Compiled topology key does not reference a node.',
        });
      }
    });
  }
  const entry = value['entry'];
  if (isValidKey(entry) && !nodeKeys.has(entry)) {
    faults.add({
      code: 'DECODE_REFERENCE',
      path: '/entry',
      message: 'Compiled pipeline entry does not reference a node.',
    });
  }
};

export const inspectCompiledRootMembers = (
  value: Record<string, unknown>,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
  referencesOnly = false,
) => {
  if (!referencesOnly) {
    inspectShape(value, faults);
    inspectTopology(value['topologicalOrder'], undefined, faults);
    inspectEntry(value['entry'], undefined, faults);
  } else if (nodeKeys !== undefined) {
    inspectReferences(value, nodeKeys, faults);
  }
  return {
    edges: Array.isArray(value['edges']) ? value['edges'] : undefined,
    facts: Array.isArray(value['facts']) ? value['facts'] : undefined,
    forkRegions: Array.isArray(value['forkRegions']) ? value['forkRegions'] : undefined,
    incomingIndex: Array.isArray(value['incomingIndex']) ? value['incomingIndex'] : undefined,
    nodeIndex: Array.isArray(value['nodeIndex']) ? value['nodeIndex'] : undefined,
    nodes: Array.isArray(value['nodes']) ? value['nodes'] : undefined,
    outgoingIndex: Array.isArray(value['outgoingIndex']) ? value['outgoingIndex'] : undefined,
    topologicalOrder: Array.isArray(value['topologicalOrder'])
      ? value['topologicalOrder']
      : undefined,
  };
};
