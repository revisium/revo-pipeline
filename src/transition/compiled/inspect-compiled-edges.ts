import { isValidKey, isValidSemanticName } from '../../policy/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';

const FIELDS = ['branch', 'fork', 'from', 'outcome', 'role', 'to'] as const;
const FIELD_SET: ReadonlySet<string> = new Set(FIELDS);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const schema = (faults: CompiledInspectionFaultCollector, path: string, message: string): void =>
  faults.add({ code: 'DECODE_SCHEMA', path, message });

const hasExactFields = (
  edge: Record<string, unknown>,
  path: string,
  faults: CompiledInspectionFaultCollector,
): boolean => {
  const fields = new Set(Object.keys(edge));
  FIELDS.forEach((field) => {
    if (!fields.has(field)) {
      schema(faults, `${path}/${field}`, 'Required compiled edge field is missing.');
    }
  });
  fields.forEach((field) => {
    if (!FIELD_SET.has(field)) {
      schema(faults, `${path}/${field}`, 'Compiled edge field is not allowed.');
    }
  });
  return fields.size === FIELDS.length && FIELDS.every((field) => fields.has(field));
};

const inspectEndpoints = (
  edge: Record<string, unknown>,
  path: string,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  for (const endpoint of ['from', 'to'] as const) {
    const key = edge[endpoint];
    if (!isValidKey(key)) {
      schema(faults, `${path}/${endpoint}`, 'Compiled pipeline edge endpoint is invalid.');
    } else if (nodeKeys !== undefined && !nodeKeys.has(key)) {
      faults.add({
        code: 'DECODE_REFERENCE',
        path: `${path}/${endpoint}`,
        message: 'Compiled pipeline edge endpoint does not reference a node.',
      });
    }
  }
};

const ownershipFieldsAreValid = (
  edge: Record<string, unknown>,
  path: string,
  faults: CompiledInspectionFaultCollector,
): boolean => {
  let valid = true;
  if (edge['fork'] !== null && !isValidKey(edge['fork'])) {
    schema(faults, `${path}/fork`, 'Compiled pipeline edge fork is invalid.');
    valid = false;
  }
  if (edge['branch'] !== null && !isValidSemanticName(edge['branch'])) {
    schema(faults, `${path}/branch`, 'Compiled pipeline edge branch is invalid.');
    valid = false;
  }
  return valid;
};

const inspectOwnership = (
  edge: Record<string, unknown>,
  path: string,
  nodes: readonly unknown[] | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  const fork = edge['fork'];
  const branch = edge['branch'];
  const forkNode = nodes?.find(
    (node) => isRecord(node) && node['kind'] === 'fork' && node['key'] === fork,
  );
  if (nodes !== undefined && fork !== null && !forkNode) {
    faults.add({
      code: 'DECODE_REFERENCE',
      path: `${path}/fork`,
      message: 'Compiled edge fork does not reference a fork node.',
    });
    return;
  }
  const inconsistent =
    (fork === null && branch !== null) ||
    (edge['role'] === 'readiness' && (fork === null || branch === null)) ||
    (branch === null && edge['role'] !== 'activation');
  if (inconsistent) {
    faults.add({
      code: 'DECODE_REFERENCE',
      path: `${path}/${fork === null ? 'fork' : 'branch'}`,
      message: 'Compiled edge ownership fields are inconsistent.',
    });
    return;
  }
  if (branch !== null) {
    const branches = isRecord(forkNode) ? forkNode['branches'] : undefined;
    if (
      !Array.isArray(branches) ||
      !branches.some((candidate) => isRecord(candidate) && candidate['name'] === branch)
    ) {
      faults.add({
        code: 'DECODE_REFERENCE',
        path: `${path}/branch`,
        message: 'Compiled edge branch does not belong to its fork.',
      });
    }
  }
};

const inspectEdge = (
  edge: unknown,
  index: number,
  nodes: readonly unknown[] | undefined,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  const path = `/edges/${index}`;
  if (!isRecord(edge)) {
    schema(faults, path, 'Compiled pipeline edge must be an object.');
    return;
  }
  if (!hasExactFields(edge, path, faults)) {
    return;
  }
  inspectEndpoints(edge, path, nodeKeys, faults);
  if (!isValidSemanticName(edge['outcome'])) {
    schema(faults, `${path}/outcome`, 'Compiled pipeline edge outcome is invalid.');
  }
  const validRole = edge['role'] === 'activation' || edge['role'] === 'readiness';
  if (!validRole) {
    schema(faults, `${path}/role`, 'Compiled pipeline edge role is invalid.');
  }
  if (ownershipFieldsAreValid(edge, path, faults) && validRole && nodes !== undefined) {
    inspectOwnership(edge, path, nodes, faults);
  }
};

export const inspectCompiledEdges = (
  edges: readonly unknown[],
  nodes: readonly unknown[] | undefined,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  edges.forEach((edge, index) => inspectEdge(edge, index, nodes, nodeKeys, faults));
};
