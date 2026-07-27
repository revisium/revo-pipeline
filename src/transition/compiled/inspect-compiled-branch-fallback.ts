import { isValidKey, isValidSemanticName } from '../../policy/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const schema = (path: string, message: string, faults: CompiledInspectionFaultCollector): void =>
  faults.add({ code: 'DECODE_SCHEMA', path, message });

const inspectShape = (
  fallback: unknown,
  names: ReadonlySet<string>,
  path: string,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (
    fallback !== null &&
    (!isRecord(fallback) ||
      Object.keys(fallback).length !== 2 ||
      !('name' in fallback) ||
      !('to' in fallback))
  ) {
    schema(`${path}/default`, 'Compiled branch default is invalid.', faults);
    return;
  }
  if (!isRecord(fallback)) {
    return;
  }
  const name = fallback['name'];
  if (!isValidSemanticName(name) || names.has(name)) {
    schema(`${path}/default/name`, 'Compiled branch default name is invalid.', faults);
  }
  if (!isValidKey(fallback['to'])) {
    schema(`${path}/default/to`, 'Compiled branch default target is invalid.', faults);
  }
};

const inspectCoverage = (
  fallback: unknown,
  factType: string | undefined,
  domains: ReadonlySet<string>,
  path: string,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (factType !== 'null' && factType !== 'boolean') {
    return;
  }
  const fullyCovered =
    (factType === 'null' && domains.has('null:')) ||
    (factType === 'boolean' && domains.has('boolean:true') && domains.has('boolean:false'));
  if ((fullyCovered && fallback !== null) || (!fullyCovered && fallback === null)) {
    schema(`${path}/default`, 'Compiled branch default does not match predicate coverage.', faults);
  }
};

export const inspectCompiledBranchFallback = (
  fallback: unknown,
  names: ReadonlySet<string>,
  factType: string | undefined,
  domains: ReadonlySet<string>,
  path: string,
  faults: CompiledInspectionFaultCollector,
): void => {
  inspectShape(fallback, names, path, faults);
  inspectCoverage(fallback, factType, domains, path, faults);
};
