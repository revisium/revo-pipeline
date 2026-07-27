import { compareUnicodeCodePoints, isValidKey, PIPELINE_LIMITS } from '../../policy/index.js';
import type { CompiledPipeline } from '../../spec/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';
import { inspectCompiledEdges } from './inspect-compiled-edges.js';
import { inspectCompiledFacts } from './inspect-compiled-facts.js';
import { inspectCompiledIndexes } from './inspect-compiled-indexes.js';
import { inspectCompiledNodeMembers } from './inspect-compiled-node-members.js';
import { inspectCompiledRegions } from './inspect-compiled-regions.js';

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

const NODE_KINDS = new Set([
  'branch',
  'consensus',
  'fork',
  'humanGate',
  'join',
  'task',
  'terminal',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const schema = (faults: CompiledInspectionFaultCollector, path: string, message: string): void =>
  faults.add({ code: 'DECODE_SCHEMA', path, message });

const inspectRootShape = (
  value: Record<string, unknown>,
  faults: CompiledInspectionFaultCollector,
): void => {
  const keys = new Set(Object.keys(value));
  for (const field of ROOT_FIELDS) {
    if (!keys.has(field)) {
      schema(faults, `/${field}`, 'Required compiled pipeline field is missing.');
    }
  }
  for (const key of keys) {
    if (!ROOT_FIELD_SET.has(key)) {
      schema(
        faults,
        `/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        'Compiled pipeline field is not allowed.',
      );
    }
  }
  if (keys.has('schemaVersion') && value['schemaVersion'] !== 1) {
    schema(faults, '/schemaVersion', 'Compiled pipeline schemaVersion must be 1.');
  }
  if (keys.has('entry') && typeof value['entry'] !== 'string') {
    schema(faults, '/entry', 'Compiled pipeline entry must be a string.');
  }
  for (const field of COLLECTION_FIELDS) {
    if (keys.has(field) && !Array.isArray(value[field])) {
      schema(faults, `/${field}`, 'Compiled pipeline field must be an array.');
    }
  }
};

const inspectNodes = (
  nodes: readonly unknown[],
  faults: CompiledInspectionFaultCollector,
): ReadonlySet<string> => {
  const keys = new Set<string>();
  let previous: string | undefined;
  nodes.forEach((node, index) => {
    const path = `/nodes/${index}`;
    if (!isRecord(node)) {
      schema(faults, path, 'Compiled pipeline node must be an object.');
      return;
    }
    if (typeof node['kind'] !== 'string' || !NODE_KINDS.has(node['kind'])) {
      schema(faults, `${path}/kind`, 'Compiled pipeline node kind is invalid.');
    }
    const key = node['key'];
    if (!isValidKey(key)) {
      schema(faults, `${path}/key`, 'Compiled pipeline node key is invalid.');
      return;
    }
    if (keys.has(key)) {
      faults.add({
        code: 'DECODE_REFERENCE',
        path: `${path}/key`,
        message: 'Compiled pipeline node key is duplicated.',
      });
    } else if (previous !== undefined && compareUnicodeCodePoints(previous, key) > 0) {
      faults.add({
        code: 'DECODE_CANONICAL',
        path,
        message: 'Compiled pipeline nodes are not in canonical order.',
      });
    }
    keys.add(key);
    previous = key;
  });
  return keys;
};

const inspectNodeCollection = (
  nodes: readonly unknown[],
  factDeclarations:
    | {
        readonly complete: boolean;
        readonly keys: ReadonlySet<string>;
        readonly types: ReadonlyMap<string, string>;
      }
    | undefined,
  faults: CompiledInspectionFaultCollector,
): ReadonlySet<string> => {
  const nodeKeys = inspectNodes(nodes, faults);
  let candidates = 0;
  let resolutions = 0;
  nodes.forEach((node, index) => {
    if (!isRecord(node) || typeof node['kind'] !== 'string' || !NODE_KINDS.has(node['kind'])) {
      return;
    }
    inspectCompiledNodeMembers(node, `/nodes/${index}`, nodeKeys, factDeclarations, faults);
    candidates +=
      node['kind'] === 'consensus' && Array.isArray(node['candidates'])
        ? node['candidates'].length
        : 0;
    resolutions +=
      node['kind'] === 'humanGate' && Array.isArray(node['resolutions'])
        ? node['resolutions'].length
        : 0;
    for (const [total, maximum, field] of [
      [candidates, PIPELINE_LIMITS.definition.candidatesTotal, 'candidates'],
      [resolutions, PIPELINE_LIMITS.definition.resolutionsTotal, 'resolutions'],
    ] as const) {
      if (total > maximum) {
        faults.add({
          code: 'DECODE_LIMIT',
          path: `/nodes/${index}/${field}`,
          message: `Compiled ${field} total exceeds its limit.`,
        });
      }
    }
    if (candidates > PIPELINE_LIMITS.definition.candidatesTotal) {
      candidates = Number.NEGATIVE_INFINITY;
    }
    if (resolutions > PIPELINE_LIMITS.definition.resolutionsTotal) {
      resolutions = Number.NEGATIVE_INFINITY;
    }
  });
  return nodeKeys;
};

export const inspectCompiledMembers = (
  value: unknown,
  faults: CompiledInspectionFaultCollector,
): value is CompiledPipeline => {
  if (!isRecord(value)) {
    return false;
  }
  inspectRootShape(value, faults);
  const available = {
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
  const factDeclarations = available.facts
    ? inspectCompiledFacts(available.facts, faults)
    : undefined;
  const nodeKeys = available.nodes
    ? inspectNodeCollection(available.nodes, factDeclarations, faults)
    : undefined;
  if (available.edges) {
    inspectCompiledEdges(available.edges, available.nodes, nodeKeys, faults);
  }
  inspectCompiledIndexes(
    {
      incomingIndex: available.incomingIndex,
      nodeIndex: available.nodeIndex,
      outgoingIndex: available.outgoingIndex,
    },
    nodeKeys,
    available.edges?.length,
    faults,
  );
  inspectCompiledRegions(available.forkRegions, nodeKeys, faults);
  if (available.topologicalOrder) {
    available.topologicalOrder.forEach((key, index) => {
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
  }
  const entry = value['entry'];
  if (typeof entry === 'string' && !isValidKey(entry)) {
    schema(faults, '/entry', 'Compiled pipeline entry is invalid.');
  } else if (typeof entry === 'string' && nodeKeys !== undefined && !nodeKeys.has(entry)) {
    faults.add({
      code: 'DECODE_REFERENCE',
      path: '/entry',
      message: 'Compiled pipeline entry does not reference a node.',
    });
  }
  return !faults.hasFaults;
};
