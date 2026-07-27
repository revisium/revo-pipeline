import {
  compareUnicodeCodePoints,
  isValidKey,
  isValidSemanticName,
  PIPELINE_LIMITS,
} from '../../policy/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';
import { inspectCompiledBranchSchema } from './inspect-compiled-branch-schema.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface FactDeclarations {
  readonly complete: boolean;
  readonly keys: ReadonlySet<string>;
  readonly types: ReadonlyMap<string, string>;
}

const reference = (
  value: unknown,
  path: string,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!isValidKey(value)) {
    faults.add({ code: 'DECODE_SCHEMA', path, message: 'Compiled node target is invalid.' });
  } else if (nodeKeys !== undefined && !nodeKeys.has(value)) {
    faults.add({
      code: 'DECODE_REFERENCE',
      path,
      message: 'Compiled node target does not reference a node.',
    });
  }
};

const namedRoutes = (
  routes: unknown,
  path: string,
  nameField: string,
  fields: readonly string[],
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
  ordered = true,
): void => {
  if (!Array.isArray(routes)) {
    faults.add({ code: 'DECODE_SCHEMA', path, message: 'Compiled node routes must be an array.' });
    return;
  }
  let previous: string | undefined;
  const seen = new Set<string>();
  routes.forEach((route, index) => {
    const routePath = `${path}/${index}`;
    if (
      !isRecord(route) ||
      Object.keys(route).length !== fields.length ||
      !fields.every((field) => field in route)
    ) {
      faults.add({
        code: 'DECODE_SCHEMA',
        path: routePath,
        message: 'Compiled node route fields are invalid.',
      });
      return;
    }
    reference(
      route['to'] ?? route['entry'],
      `${routePath}/${route['to'] === undefined ? 'entry' : 'to'}`,
      nodeKeys,
      faults,
    );
    const name = route[nameField];
    if (!isValidSemanticName(name)) {
      faults.add({
        code: 'DECODE_SCHEMA',
        path: `${routePath}/${nameField}`,
        message: 'Compiled route name is invalid.',
      });
    } else if (ordered && seen.has(name)) {
      faults.add({
        code: 'DECODE_REFERENCE',
        path: `${routePath}/${nameField}`,
        message: 'Compiled node route name is duplicated.',
      });
    } else if (ordered && previous !== undefined && compareUnicodeCodePoints(previous, name) > 0) {
      faults.add({
        code: 'DECODE_CANONICAL',
        path: routePath,
        message: 'Compiled node routes are not in canonical order.',
      });
    }
    if (typeof name === 'string') {
      seen.add(name);
    }
    previous = typeof name === 'string' ? name : previous;
  });
};

const inspectBranchRoutes = (
  node: Record<string, unknown>,
  path: string,
  nodeKeys: ReadonlySet<string> | undefined,
  factDeclarations: FactDeclarations | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  inspectCompiledBranchSchema(node, path, factDeclarations?.types, faults);
  if (!isValidKey(node['fact'])) {
    faults.add({
      code: 'DECODE_SCHEMA',
      path: `${path}/fact`,
      message: 'Compiled branch fact is invalid.',
    });
  } else if (factDeclarations?.complete === true && !factDeclarations.keys.has(node['fact'])) {
    faults.add({
      code: 'DECODE_REFERENCE',
      path: `${path}/fact`,
      message: 'Compiled branch fact is not declared.',
    });
  }
  namedRoutes(
    node['cases'],
    `${path}/cases`,
    'name',
    ['name', 'to', 'when'],
    nodeKeys,
    faults,
    false,
  );
  if (node['default'] !== null && isRecord(node['default'])) {
    reference(node['default']['to'], `${path}/default/to`, nodeKeys, faults);
  }
};

const inspectForkRoutes = (
  node: Record<string, unknown>,
  path: string,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  reference(node['join'], `${path}/join`, nodeKeys, faults);
  namedRoutes(
    node['branches'],
    `${path}/branches`,
    'name',
    ['entry', 'exit', 'name'],
    nodeKeys,
    faults,
  );
  if (!Array.isArray(node['branches'])) {
    return;
  }
  if (node['branches'].length < 2) {
    faults.add({
      code: 'DECODE_SCHEMA',
      path: `${path}/branches`,
      message: 'Compiled fork must declare at least two branches.',
    });
  } else if (node['branches'].length > PIPELINE_LIMITS.definition.forkBranchesPerNode) {
    faults.add({
      code: 'DECODE_LIMIT',
      path: `${path}/branches`,
      message: 'Compiled fork branch count is outside bounds.',
    });
  }
  node['branches'].forEach((branch, index) => {
    if (isRecord(branch)) {
      reference(branch['exit'], `${path}/branches/${index}/exit`, nodeKeys, faults);
    }
  });
};

export const inspectCompiledNodeRoutes = (
  node: Record<string, unknown>,
  path: string,
  nodeKeys: ReadonlySet<string> | undefined,
  factDeclarations: FactDeclarations | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (node['kind'] === 'branch') {
    inspectBranchRoutes(node, path, nodeKeys, factDeclarations, faults);
  }
  if (node['kind'] === 'fork') {
    inspectForkRoutes(node, path, nodeKeys, faults);
  }
  if (node['kind'] === 'humanGate') {
    namedRoutes(
      node['resolutions'],
      `${path}/resolutions`,
      'resolution',
      ['resolution', 'to'],
      nodeKeys,
      faults,
    );
  }
  if (node['kind'] === 'join') {
    reference(node['fork'], `${path}/fork`, nodeKeys, faults);
  }
};
