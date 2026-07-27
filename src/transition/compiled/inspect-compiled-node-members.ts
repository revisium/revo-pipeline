import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';
import { inspectCompiledNodePolicy } from './inspect-compiled-node-policy.js';
import { inspectCompiledNodeRoutes } from './inspect-compiled-node-routes.js';
import { inspectCompiledOutcomes } from './inspect-compiled-outcomes.js';
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  branch: ['cases', 'default', 'fact', 'key', 'kind'],
  consensus: ['candidates', 'key', 'kind', 'outcomes', 'policy'],
  fork: ['branches', 'join', 'key', 'kind'],
  humanGate: ['key', 'kind', 'resolutions', 'subject'],
  join: ['fork', 'key', 'kind', 'outcomes', 'policy'],
  task: ['key', 'kind', 'outcomes'],
  terminal: ['key', 'kind', 'outcome'],
};
const escaped = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');
const exactFields = (
  node: Record<string, unknown>,
  expected: readonly string[],
  path: string,
  faults: CompiledInspectionFaultCollector,
): boolean => {
  const allowed: ReadonlySet<string> = new Set(expected);
  const actual = new Set(Object.keys(node));
  expected.forEach((field) => {
    if (!actual.has(field)) {
      faults.add({
        code: 'DECODE_SCHEMA',
        path: `${path}/${field}`,
        message: 'Required compiled node field is missing.',
      });
    }
  });
  actual.forEach((field) => {
    if (!allowed.has(field)) {
      faults.add({
        code: 'DECODE_SCHEMA',
        path: `${path}/${escaped(field)}`,
        message: 'Compiled node field is not allowed.',
      });
    }
  });
  return expected.length === actual.size && expected.every((field) => actual.has(field));
};
export const inspectCompiledNodeMembers = (
  node: Record<string, unknown>,
  path: string,
  nodeKeys: ReadonlySet<string> | undefined,
  factDeclarations:
    | {
        readonly complete: boolean;
        readonly keys: ReadonlySet<string>;
        readonly types: ReadonlyMap<string, string>;
      }
    | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  const kind = node['kind'];
  const expected = typeof kind === 'string' ? FIELDS[kind] : undefined;
  if (!expected || !exactFields(node, expected, path, faults)) {
    return;
  }
  inspectCompiledNodePolicy(node, path, faults);
  if (kind === 'task') {
    inspectCompiledOutcomes(
      node['outcomes'],
      `${path}/outcomes`,
      ['cancelled', 'completed', 'failed', 'skipped'],
      nodeKeys,
      faults,
    );
  }
  if (kind === 'join') {
    inspectCompiledOutcomes(
      node['outcomes'],
      `${path}/outcomes`,
      ['completed', 'insufficient', 'rejected'],
      nodeKeys,
      faults,
    );
  }
  if (kind === 'consensus') {
    inspectCompiledOutcomes(
      node['outcomes'],
      `${path}/outcomes`,
      ['approved', 'insufficient', 'rejected', 'tied'],
      nodeKeys,
      faults,
    );
  }
  inspectCompiledNodeRoutes(node, path, nodeKeys, factDeclarations, faults);
  if (kind === 'humanGate') {
    if (
      typeof node['subject'] !== 'string' ||
      !Array.isArray(node['resolutions']) ||
      node['resolutions'].length < 1
    ) {
      faults.add({
        code: 'DECODE_SCHEMA',
        path: typeof node['subject'] !== 'string' ? `${path}/subject` : `${path}/resolutions`,
        message: 'Compiled human gate members are invalid.',
      });
    }
  }
  if (kind === 'terminal' && typeof node['outcome'] !== 'string') {
    faults.add({
      code: 'DECODE_SCHEMA',
      path: `${path}/outcome`,
      message: 'Compiled terminal outcome must be a string.',
    });
  }
};
