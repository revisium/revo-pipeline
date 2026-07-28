import { captureReducerInput } from '../capture-reducer-input.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const inspectCommandEnvelope = (
  input: unknown,
  faults: ReductionDiagnosticCollector,
):
  | {
      readonly value: Record<string, unknown>;
      readonly kind: 'init' | 'taskOutcome' | 'consensusVerdict' | 'humanGateResolution';
      readonly values: unknown[];
    }
  | undefined => {
  const value = captureReducerInput(input, '/command', faults);
  if (faults.hasFaults) {
    return undefined;
  }
  if (!isRecord(value) || value['schemaVersion'] !== 1) {
    faults.add('COMMAND_SCHEMA', '/command', 'Pipeline command shape is invalid.');
    return undefined;
  }
  const kind = commandKind(value['kind']);
  if (!kind) {
    faults.add('COMMAND_SCHEMA', '/command', 'Pipeline command shape is invalid.');
    return undefined;
  }
  if (!hasExactFields(value, kind)) {
    faults.add('COMMAND_SCHEMA', '/command', 'Pipeline command fields are invalid.');
    return undefined;
  }
  const needsValues = kind !== 'consensusVerdict';
  if (needsValues && !Array.isArray(value['values'])) {
    faults.add('COMMAND_SCHEMA', '/command/values', 'Pipeline command values are invalid.');
    return undefined;
  }
  const values = Array.isArray(value['values']) ? value['values'] : [];
  if (values.length > 128) {
    faults.add('COMMAND_LIMIT', '/command/values', 'Command value limit exceeded.');
    return undefined;
  }
  return { value, kind, values };
};

const commandKind = (
  value: unknown,
): 'init' | 'taskOutcome' | 'consensusVerdict' | 'humanGateResolution' | undefined => {
  if (
    value === 'init' ||
    value === 'taskOutcome' ||
    value === 'consensusVerdict' ||
    value === 'humanGateResolution'
  ) {
    return value;
  }
  return undefined;
};

const hasExactFields = (
  value: Record<string, unknown>,
  kind: 'init' | 'taskOutcome' | 'consensusVerdict' | 'humanGateResolution',
): boolean => {
  let fields: readonly string[] = ['kind', 'schemaVersion', 'values'];
  if (kind === 'taskOutcome') {
    fields = ['kind', 'occurrence', 'outcome', 'schemaVersion', 'values'];
  } else if (kind === 'consensusVerdict') {
    fields = ['candidate', 'kind', 'occurrence', 'schemaVersion', 'verdict'];
  } else if (kind === 'humanGateResolution') {
    fields = ['kind', 'occurrence', 'resolution', 'schemaVersion', 'values'];
  }
  return Object.keys(value).length === fields.length && fields.every((field) => field in value);
};
