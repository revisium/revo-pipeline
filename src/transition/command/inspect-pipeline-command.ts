import { isValidKey, isValidSemanticName } from '../../policy/index.js';
import type { PipelineCommand, PipelineValueFact } from '../../spec/index.js';
import { captureReducerInput } from '../capture-reducer-input.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';
import type { CommandInspection } from './command-inspection.js';
import { inspectCommandValues } from './inspect-command-values.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(value).length === fields.length && fields.every((field) => field in value);

export const inspectPipelineCommand = (
  input: unknown,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): CommandInspection | undefined => {
  const value = captureReducerInput(input, '/command', faults);
  if (value === undefined || faults.hasFaults) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    value['schemaVersion'] !== 1 ||
    !['init', 'taskOutcome', 'consensusVerdict', 'humanGateResolution'].includes(
      String(value['kind']),
    )
  ) {
    faults.add('COMMAND_SCHEMA', '/command', 'Pipeline command shape is invalid.');
    return undefined;
  }
  const kind = value['kind'];
  const fields =
    kind === 'init'
      ? ['kind', 'schemaVersion', 'values']
      : kind === 'taskOutcome'
        ? ['kind', 'occurrence', 'outcome', 'schemaVersion', 'values']
        : kind === 'consensusVerdict'
          ? ['candidate', 'kind', 'occurrence', 'schemaVersion', 'verdict']
          : ['kind', 'occurrence', 'resolution', 'schemaVersion', 'values'];
  if (!exact(value, fields)) {
    faults.add('COMMAND_SCHEMA', '/command', 'Pipeline command fields are invalid.');
    return undefined;
  }
  const needsValues = kind === 'init' || kind === 'taskOutcome' || kind === 'humanGateResolution';
  if (needsValues && !Array.isArray(value['values'])) {
    faults.add('COMMAND_SCHEMA', '/command/values', 'Pipeline command values are invalid.');
    return undefined;
  }
  const values = needsValues && Array.isArray(value['values']) ? value['values'] : [];
  if (values.length > 128) {
    faults.add('COMMAND_LIMIT', '/command/values', 'Command value limit exceeded.');
    return undefined;
  }
  const normalized = inspectCommandValues(values, context, faults);
  if (kind === 'taskOutcome' && value['outcome'] !== 'completed' && normalized.length > 0) {
    faults.add(
      'COMMAND_OUTCOME',
      '/command/values',
      'Only a completed task outcome may produce values.',
    );
  }
  if (kind !== 'init') {
    const occurrence = value['occurrence'];
    if (
      !isRecord(occurrence) ||
      !exact(occurrence, ['nodeKey', 'occurrenceKey']) ||
      !isValidSemanticName(occurrence['occurrenceKey']) ||
      !isValidKey(occurrence['nodeKey'])
    ) {
      faults.add('COMMAND_SCHEMA', '/command/occurrence', 'Command occurrence is invalid.');
    }
  }
  if (faults.hasFaults) {
    return undefined;
  }
  const command = buildCommand(value, normalized);
  if (!command) {
    faults.add(
      kind === 'taskOutcome' ? 'COMMAND_OUTCOME' : 'COMMAND_SCHEMA',
      '/command',
      'Pipeline command members are invalid.',
    );
    return undefined;
  }
  return { command };
};

const buildCommand = (
  value: Record<string, unknown>,
  values: readonly PipelineValueFact[],
): PipelineCommand | undefined => {
  if (value['kind'] === 'init') {
    return { schemaVersion: 1, kind: 'init', values };
  }
  const item = value['occurrence'];
  if (
    !isRecord(item) ||
    !exact(item, ['nodeKey', 'occurrenceKey']) ||
    !isValidSemanticName(item['occurrenceKey']) ||
    !isValidKey(item['nodeKey'])
  ) {
    return undefined;
  }
  const occurrence = { occurrenceKey: item['occurrenceKey'], nodeKey: item['nodeKey'] };
  if (
    value['kind'] === 'taskOutcome' &&
    ['completed', 'failed', 'cancelled', 'skipped'].includes(String(value['outcome']))
  ) {
    const outcome = value['outcome'];
    if (
      outcome === 'completed' ||
      outcome === 'failed' ||
      outcome === 'cancelled' ||
      outcome === 'skipped'
    ) {
      return { schemaVersion: 1, kind: 'taskOutcome', occurrence, outcome, values };
    }
  }
  if (
    value['kind'] === 'consensusVerdict' &&
    isValidSemanticName(value['candidate']) &&
    ['approve', 'reject', 'abstain'].includes(String(value['verdict']))
  ) {
    const verdict = value['verdict'];
    if (verdict === 'approve' || verdict === 'reject' || verdict === 'abstain') {
      return {
        schemaVersion: 1,
        kind: 'consensusVerdict',
        occurrence,
        candidate: value['candidate'],
        verdict,
      };
    }
  }
  if (value['kind'] === 'humanGateResolution' && isValidSemanticName(value['resolution'])) {
    return {
      schemaVersion: 1,
      kind: 'humanGateResolution',
      occurrence,
      resolution: value['resolution'],
      values,
    };
  }
  return undefined;
};
