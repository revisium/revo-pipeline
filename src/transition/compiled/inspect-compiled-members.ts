import { compareUnicodeCodePoints, isValidKey, PIPELINE_LIMITS } from '../../policy/index.js';
import type { CompiledPipeline } from '../../spec/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';
import { inspectCompiledEdges } from './inspect-compiled-edges.js';
import { inspectCompiledFacts } from './inspect-compiled-facts.js';
import { inspectCompiledIndexes } from './inspect-compiled-indexes.js';
import { inspectCompiledNodeMembers } from './inspect-compiled-node-members.js';
import { inspectCompiledRegions } from './inspect-compiled-regions.js';
import { inspectCompiledRootMembers } from './inspect-compiled-root-members.js';

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
  const available = inspectCompiledRootMembers(value, undefined, faults);
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
  inspectCompiledRootMembers(value, nodeKeys, faults, true);
  return !faults.hasFaults;
};
