import { isValidKey, isValidSemanticName } from '../../policy/index.js';
import type { PipelineSnapshotNode } from '../../spec/index.js';
import { captureReducerInput } from '../capture-reducer-input.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';
import { inspectSnapshotMembers } from './inspect-snapshot-members.js';
import type { SnapshotInspection } from './snapshot-inspection.js';
import { snapshotSourceIndexes } from './snapshot-source-indexes.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exact = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(value).length === fields.length && fields.every((field) => field in value);
interface CapturedSnapshot extends Record<string, unknown> {
  readonly candidateVerdicts: unknown[];
  readonly gateResolutions: unknown[];
  readonly nodes: unknown[];
  readonly occurrenceKey: string;
  readonly phase: 'uninitialized' | 'active' | 'terminal';
  readonly values: unknown[];
}

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

const inspectNodes = (
  values: unknown[],
  key: string,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): PipelineSnapshotNode[] => {
  const seen = new Set<string>();
  return values.flatMap((value, index) => {
    const path = `/snapshot/nodes/${index}`;
    if (
      !isRecord(value) ||
      !occurrence(value['occurrence'], key, `${path}/occurrence`, faults) ||
      !inspectSnapshotMembers.node(value)
    ) {
      faults.add('SNAPSHOT_SCHEMA', path, 'Snapshot node record is invalid.');
      return [];
    }
    const nodeKey = value['occurrence'].nodeKey;
    if (!context.nodeByKey.has(nodeKey)) {
      faults.add('SNAPSHOT_FOREIGN', `${path}/occurrence/nodeKey`, 'Snapshot node is foreign.');
    }
    if (seen.has(nodeKey)) {
      faults.add('SNAPSHOT_DUPLICATE', path, 'Snapshot node is duplicated.');
    }
    seen.add(nodeKey);
    if (
      value['state'] === 'retired' &&
      !inspectSnapshotMembers.terminal(value['terminal'], key, `${path}/terminal`, faults)
    ) {
      return [];
    }
    return [value];
  });
};

export const inspectPipelineSnapshot = (
  input: unknown,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): SnapshotInspection | undefined => {
  const captured = captureReducerInput(input, '/snapshot', faults);
  if (captured === undefined || faults.hasFaults) {
    return undefined;
  }
  return promoteCapturedSnapshot(captured, context, faults);
};

const promoteCapturedSnapshot = (
  captured: unknown,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): SnapshotInspection | undefined => {
  if (!isCapturedSnapshot(captured, faults)) {
    return undefined;
  }
  if (snapshotLimitExceeded(captured)) {
    faults.add('SNAPSHOT_LIMIT', '/snapshot', 'Pipeline snapshot collection limit exceeded.');
    return undefined;
  }
  const nodes = inspectNodes(captured['nodes'], captured['occurrenceKey'], context, faults);
  const values = inspectSnapshotMembers.values(
    captured['values'],
    captured['occurrenceKey'],
    faults,
  );
  const verdicts = inspectSnapshotMembers.verdicts(
    captured['candidateVerdicts'],
    captured['occurrenceKey'],
    faults,
  );
  const resolutions = inspectSnapshotMembers.resolutions(
    captured['gateResolutions'],
    captured['occurrenceKey'],
    faults,
  );
  const terminal =
    captured['terminal'] === null
      ? null
      : inspectSnapshotMembers.terminal(
          captured['terminal'],
          captured['occurrenceKey'],
          '/snapshot/terminal',
          faults,
        );
  if (
    faults.hasFaults ||
    nodes.length !== captured['nodes'].length ||
    !inspectSnapshotMembers.terminalPhase(captured)
  ) {
    return undefined;
  }
  return promoteSnapshotPhase(captured, nodes, values, verdicts, resolutions, terminal, faults);
};

const isCapturedSnapshot = (
  captured: unknown,
  faults: ReductionDiagnosticCollector,
): captured is CapturedSnapshot => {
  if (
    !isRecord(captured) ||
    !exact(captured, [
      'candidateVerdicts',
      'gateResolutions',
      'nodes',
      'occurrenceKey',
      'phase',
      'schemaVersion',
      'terminal',
      'values',
    ])
  ) {
    faults.add('SNAPSHOT_SCHEMA', '/snapshot', 'Pipeline snapshot shape is invalid.');
    return false;
  }
  if (
    captured['schemaVersion'] !== 1 ||
    !isValidSemanticName(captured['occurrenceKey']) ||
    !['uninitialized', 'active', 'terminal'].includes(String(captured['phase'])) ||
    !Array.isArray(captured['values']) ||
    !Array.isArray(captured['nodes']) ||
    !Array.isArray(captured['candidateVerdicts']) ||
    !Array.isArray(captured['gateResolutions'])
  ) {
    faults.add('SNAPSHOT_SCHEMA', '/snapshot', 'Pipeline snapshot members are invalid.');
    return false;
  }
  return true;
};

const snapshotLimitExceeded = (captured: CapturedSnapshot): boolean =>
  captured['values'].length > 128 ||
  captured['nodes'].length > 256 ||
  captured['candidateVerdicts'].length > 1024 ||
  captured['gateResolutions'].length > 256 ||
  captured['values'].length +
    captured['nodes'].length +
    captured['candidateVerdicts'].length +
    captured['gateResolutions'].length >
    1664;

const promoteSnapshotPhase = (
  captured: CapturedSnapshot,
  nodes: PipelineSnapshotNode[],
  values: SnapshotInspection['snapshot']['values'],
  verdicts: SnapshotInspection['snapshot']['candidateVerdicts'],
  resolutions: SnapshotInspection['snapshot']['gateResolutions'],
  terminal: SnapshotInspection['snapshot']['terminal'],
  faults: ReductionDiagnosticCollector,
): SnapshotInspection | undefined => {
  const base = {
    schemaVersion: 1,
    occurrenceKey: captured['occurrenceKey'],
    values,
    nodes,
    candidateVerdicts: verdicts,
    gateResolutions: resolutions,
  } as const;
  const sourceIndexes = snapshotSourceIndexes(values, nodes, verdicts, resolutions);
  if (captured['phase'] === 'uninitialized') {
    if (
      values.length ||
      nodes.length ||
      verdicts.length ||
      resolutions.length ||
      captured['terminal'] !== null
    ) {
      faults.add('SNAPSHOT_PHASE', '/snapshot/phase', 'Uninitialized snapshot is not empty.');
      return undefined;
    }
    return {
      snapshot: {
        ...base,
        phase: 'uninitialized',
        values: [],
        nodes: [],
        candidateVerdicts: [],
        gateResolutions: [],
        terminal: null,
      },
      sourceIndexes,
    };
  }
  if (captured['phase'] === 'active') {
    if (nodes.some((node) => node.state === 'retired')) {
      faults.add('SNAPSHOT_PHASE', '/snapshot/nodes', 'Active snapshot contains a retired node.');
      return undefined;
    }
    return {
      snapshot: {
        ...base,
        phase: 'active',
        nodes: nodes.filter(
          (
            node,
          ): node is Extract<PipelineSnapshotNode, { readonly state: 'enabled' | 'terminal' }> =>
            node.state !== 'retired',
        ),
        terminal: null,
      },
      sourceIndexes,
    };
  }
  return terminal
    ? { snapshot: { ...base, phase: 'terminal', terminal }, sourceIndexes }
    : undefined;
};
