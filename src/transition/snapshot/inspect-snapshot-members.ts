import { isValidKey, isValidSemanticName } from '../../policy/index.js';
import type {
  JsonScalar,
  PipelineCandidateVerdictRecord,
  PipelineGateResolutionRecord,
  PipelineSnapshotNode,
  PipelineTerminal,
  PipelineValueRecord,
  PipelineValueSource,
} from '../../spec/index.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(value).length === fields.length && fields.every((field) => field in value);
const occurrence = (
  value: unknown,
  key: string,
  path: string,
  faults: ReductionDiagnosticCollector,
): value is { occurrenceKey: string; nodeKey: string } => {
  if (
    !isRecord(value) ||
    !exact(value, ['occurrenceKey', 'nodeKey']) ||
    !isValidSemanticName(value['occurrenceKey']) ||
    !isValidKey(value['nodeKey'])
  ) {
    faults.add('SNAPSHOT_SCHEMA', path, 'Snapshot node occurrence is invalid.');
    return false;
  }
  if (value['occurrenceKey'] !== key) {
    faults.add('SNAPSHOT_FOREIGN', `${path}/occurrenceKey`, 'Snapshot occurrence is foreign.');
  }
  return true;
};
const scalar = (value: unknown): value is JsonScalar =>
  value === null ||
  typeof value === 'boolean' ||
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0));
const isSnapshotNode = (value: Record<string, unknown>): value is PipelineSnapshotNode => {
  if (
    !isRecord(value['occurrence']) ||
    typeof value['occurrence']['occurrenceKey'] !== 'string' ||
    typeof value['occurrence']['nodeKey'] !== 'string'
  ) {
    return false;
  }
  if (value['state'] === 'enabled') {
    return exact(value, ['occurrence', 'state']);
  }
  if (value['state'] === 'terminal') {
    return exact(value, ['occurrence', 'outcome', 'state']) && typeof value['outcome'] === 'string';
  }
  return (
    value['state'] === 'retired' &&
    exact(value, ['occurrence', 'state', 'terminal']) &&
    isRecord(value['terminal'])
  );
};

const inspectSource = (
  value: unknown,
  occurrenceKey: string,
  path: string,
  faults: ReductionDiagnosticCollector,
): PipelineValueSource | undefined => {
  if (!isRecord(value) || typeof value['kind'] !== 'string') {
    faults.add('SNAPSHOT_SCHEMA', path, 'Snapshot value source is invalid.');
    return undefined;
  }
  if (
    value['kind'] === 'init' &&
    exact(value, ['kind', 'occurrenceKey']) &&
    isValidSemanticName(value['occurrenceKey'])
  ) {
    return { kind: 'init', occurrenceKey: value['occurrenceKey'] };
  }
  if (
    (value['kind'] === 'taskOutcome' || value['kind'] === 'humanGateResolution') &&
    exact(value, ['kind', 'occurrence']) &&
    occurrence(value['occurrence'], occurrenceKey, `${path}/occurrence`, faults)
  ) {
    return { kind: value['kind'], occurrence: value['occurrence'] };
  }
  faults.add('SNAPSHOT_SCHEMA', path, 'Snapshot value source is invalid.');
  return undefined;
};

const inspectValues = (
  items: readonly unknown[],
  occurrenceKey: string,
  faults: ReductionDiagnosticCollector,
): PipelineValueRecord[] =>
  items.flatMap((value, index) => {
    const path = `/snapshot/values/${index}`;
    if (
      !isRecord(value) ||
      !exact(value, ['fact', 'source']) ||
      !isRecord(value['fact']) ||
      !exact(value['fact'], ['key', 'value']) ||
      !isValidKey(value['fact']['key']) ||
      !scalar(value['fact']['value'])
    ) {
      faults.add('SNAPSHOT_SCHEMA', path, 'Snapshot value record is invalid.');
      return [];
    }
    const source = inspectSource(value['source'], occurrenceKey, `${path}/source`, faults);
    return source
      ? [{ fact: { key: value['fact']['key'], value: value['fact']['value'] }, source }]
      : [];
  });

const inspectVerdicts = (
  items: readonly unknown[],
  occurrenceKey: string,
  faults: ReductionDiagnosticCollector,
): PipelineCandidateVerdictRecord[] =>
  items.flatMap((value, index) => {
    const path = `/snapshot/candidateVerdicts/${index}`;
    if (
      !isRecord(value) ||
      !exact(value, ['candidate', 'occurrence', 'verdict']) ||
      !occurrence(value['occurrence'], occurrenceKey, `${path}/occurrence`, faults) ||
      !isValidSemanticName(value['candidate'])
    ) {
      faults.add('SNAPSHOT_SCHEMA', path, 'Snapshot verdict record is invalid.');
      return [];
    }
    const verdict = value['verdict'];
    if (verdict !== 'approve' && verdict !== 'reject' && verdict !== 'abstain') {
      faults.add('SNAPSHOT_SCHEMA', `${path}/verdict`, 'Snapshot verdict is invalid.');
      return [];
    }
    return [{ occurrence: value['occurrence'], candidate: value['candidate'], verdict }];
  });

const inspectResolutions = (
  items: readonly unknown[],
  occurrenceKey: string,
  faults: ReductionDiagnosticCollector,
): PipelineGateResolutionRecord[] =>
  items.flatMap((value, index) => {
    const path = `/snapshot/gateResolutions/${index}`;
    if (
      !isRecord(value) ||
      !exact(value, ['occurrence', 'resolution']) ||
      !occurrence(value['occurrence'], occurrenceKey, `${path}/occurrence`, faults) ||
      !isValidSemanticName(value['resolution'])
    ) {
      faults.add('SNAPSHOT_SCHEMA', path, 'Snapshot gate resolution is invalid.');
      return [];
    }
    return [{ occurrence: value['occurrence'], resolution: value['resolution'] }];
  });

const inspectTerminal = (
  value: unknown,
  occurrenceKey: string,
  path: string,
  faults: ReductionDiagnosticCollector,
): PipelineTerminal | null => {
  if (
    !isRecord(value) ||
    !exact(value, ['occurrence', 'outcome']) ||
    !occurrence(value['occurrence'], occurrenceKey, `${path}/occurrence`, faults) ||
    typeof value['outcome'] !== 'string'
  ) {
    faults.add('SNAPSHOT_SCHEMA', path, 'Snapshot terminal is invalid.');
    return null;
  }
  return { occurrence: value['occurrence'], outcome: value['outcome'] };
};

export const inspectSnapshotMembers = {
  resolutions: inspectResolutions,
  terminal: inspectTerminal,
  node: isSnapshotNode,
  terminalPhase: (value: Record<string, unknown>): boolean =>
    (value['phase'] === 'terminal' && value['terminal'] !== null) ||
    (value['phase'] !== 'terminal' && value['terminal'] === null),
  values: inspectValues,
  verdicts: inspectVerdicts,
} as const;
