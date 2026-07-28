import { captureReducerContainer } from './capture-reducer-container.js';
import type { CaptureReducerContext } from './capture-reducer-context.js';
import type { ReductionDiagnosticCollector } from './reduction/reduction-diagnostic-collector.js';

const limitCode = (root: CaptureReducerContext['root']) =>
  root === '/snapshot' ? ('SNAPSHOT_LIMIT' as const) : ('COMMAND_LIMIT' as const);

const capture = (
  value: unknown,
  path: string,
  depth: number,
  context: CaptureReducerContext,
): unknown => {
  context.visits += 1;
  if (context.visits > 16_384) {
    context.faults.add(limitCode(context.root), path, 'Portable value visit limit exceeded.');
    return undefined;
  }
  if (depth > 8) {
    context.faults.add(limitCode(context.root), path, 'Portable value depth limit exceeded.');
    return undefined;
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && !Object.is(value, -0)) {
      return value;
    }
    context.faults.add(context.code, path, 'Portable number is invalid.');
    return undefined;
  }
  if (typeof value === 'string') {
    if (value === value.normalize('NFC') && Array.from(value).length <= 512) {
      return value;
    }
    context.faults.add(context.code, path, 'Portable string is invalid.');
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    context.faults.add(context.code, path, 'Value is not portable data.');
    return undefined;
  }
  return captureReducerContainer(value, path, depth, context, capture);
};

export const captureReducerInput = (
  value: unknown,
  root: '/snapshot' | '/command',
  faults: ReductionDiagnosticCollector,
): unknown =>
  capture(value, root, 0, {
    root,
    code: root === '/snapshot' ? 'SNAPSHOT_TYPE' : 'COMMAND_TYPE',
    faults,
    visits: 0,
  });
