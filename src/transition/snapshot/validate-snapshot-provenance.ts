import type { PipelineSnapshotNode, PipelineValueRecord } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';
import type { SnapshotInspection } from './snapshot-inspection.js';

export const validateSnapshotProvenance = (
  inspection: SnapshotInspection,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): void => {
  const snapshot = inspection.snapshot;
  const nodes = new Map(
    snapshot.nodes.map((node, index) => [node.occurrence.nodeKey, { node, index }]),
  );
  const valueKeys = new Set<string>();
  snapshot.values.forEach((record, index) => {
    const path = `/snapshot/values/${index}`;
    if (valueKeys.has(record.fact.key)) {
      faults.add('SNAPSHOT_DUPLICATE', `${path}/fact/key`, 'Snapshot value key is duplicated.');
    }
    valueKeys.add(record.fact.key);
    if (!context.compiled.snapshot.facts.some((fact) => fact.key === record.fact.key)) {
      faults.add('SNAPSHOT_FOREIGN', `${path}/fact/key`, 'Snapshot value fact is foreign.');
    }
    validateValueSource(record, path, snapshot, nodes, context, faults);
  });
  inspectEvidence(
    snapshot.candidateVerdicts,
    snapshot.gateResolutions,
    snapshot.occurrenceKey,
    context,
    faults,
  );
};

const validateValueSource = (
  record: PipelineValueRecord,
  path: string,
  snapshot: SnapshotInspection['snapshot'],
  nodes: ReadonlyMap<string, { readonly node: PipelineSnapshotNode; readonly index: number }>,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): void => {
  const source = record.source;
  const sourceOccurrence =
    source.kind === 'init' ? source.occurrenceKey : source.occurrence.occurrenceKey;
  if (sourceOccurrence !== snapshot.occurrenceKey) {
    faults.add(
      'SNAPSHOT_FOREIGN',
      source.kind === 'init'
        ? `${path}/source/occurrenceKey`
        : `${path}/source/occurrence/occurrenceKey`,
      'Snapshot value source occurrence is foreign.',
    );
  }
  if (source.kind === 'init') {
    return;
  }
  const sourceNode = nodes.get(source.occurrence.nodeKey);
  const compiled = context.nodeByKey.get(source.occurrence.nodeKey);
  const expectedKind = source.kind === 'taskOutcome' ? 'task' : 'humanGate';
  if (compiled?.kind !== expectedKind) {
    faults.add(
      'SNAPSHOT_FOREIGN',
      `${path}/source/occurrence/nodeKey`,
      'Snapshot value source node is foreign.',
    );
    return;
  }
  if (!sourceNode) {
    faults.add('SNAPSHOT_PREMATURE', `${path}/source`, 'Snapshot value source is not completed.');
    return;
  }
  if (source.kind === 'taskOutcome') {
    if (sourceNode.node.state !== 'terminal') {
      faults.add('SNAPSHOT_PREMATURE', `${path}/source`, 'Snapshot task source is not completed.');
      return;
    }
    if (sourceNode.node.outcome !== 'completed') {
      faults.add(
        'SNAPSHOT_OUTCOME',
        `/snapshot/nodes/${sourceNode.index}/outcome`,
        'Task source outcome is invalid.',
      );
    }
  }
  if (source.kind === 'humanGateResolution') {
    const resolution = snapshot.gateResolutions.find(
      (item) => item.occurrence.nodeKey === source.occurrence.nodeKey,
    );
    if (!resolution) {
      faults.add('SNAPSHOT_RESOLUTION', `${path}/source`, 'Gate source resolution is missing.');
    } else if (
      sourceNode.node.state === 'retired' &&
      (snapshot.phase !== 'terminal' ||
        sourceNode.node.terminal.occurrence.nodeKey !== snapshot.terminal.occurrence.nodeKey ||
        sourceNode.node.terminal.outcome !== snapshot.terminal.outcome)
    ) {
      faults.add(
        'SNAPSHOT_PHASE',
        `/snapshot/nodes/${sourceNode.index}`,
        'Retired gate source is invalid.',
      );
    } else if (
      sourceNode.node.state === 'terminal' &&
      sourceNode.node.outcome !== resolution.resolution
    ) {
      faults.add(
        'SNAPSHOT_OUTCOME',
        `/snapshot/nodes/${sourceNode.index}/outcome`,
        'Gate source outcome is invalid.',
      );
    }
  }
};

const inspectEvidence = (
  verdicts: SnapshotInspection['snapshot']['candidateVerdicts'],
  resolutions: SnapshotInspection['snapshot']['gateResolutions'],
  occurrenceKey: string,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): void => {
  const verdictKeys = new Set<string>();
  verdicts.forEach((record, index) => {
    const path = `/snapshot/candidateVerdicts/${index}`;
    if (record.occurrence.occurrenceKey !== occurrenceKey) {
      faults.add(
        'SNAPSHOT_FOREIGN',
        `${path}/occurrence/occurrenceKey`,
        'Verdict occurrence is foreign.',
      );
    }
    if (context.nodeByKey.get(record.occurrence.nodeKey)?.kind !== 'consensus') {
      faults.add('SNAPSHOT_FOREIGN', `${path}/occurrence/nodeKey`, 'Verdict node is foreign.');
    } else if (!context.candidatesByNode.get(record.occurrence.nodeKey)?.has(record.candidate)) {
      faults.add('SNAPSHOT_CANDIDATE', `${path}/candidate`, 'Verdict candidate is foreign.');
    }
    const identity = `${record.occurrence.nodeKey}\0${record.candidate}`;
    if (verdictKeys.has(identity)) {
      faults.add('SNAPSHOT_DUPLICATE', `${path}/candidate`, 'Verdict identity is duplicated.');
    }
    verdictKeys.add(identity);
  });
  const gateKeys = new Set<string>();
  resolutions.forEach((record, index) => {
    const path = `/snapshot/gateResolutions/${index}`;
    if (record.occurrence.occurrenceKey !== occurrenceKey) {
      faults.add(
        'SNAPSHOT_FOREIGN',
        `${path}/occurrence/occurrenceKey`,
        'Resolution occurrence is foreign.',
      );
    }
    if (context.nodeByKey.get(record.occurrence.nodeKey)?.kind !== 'humanGate') {
      faults.add(
        'SNAPSHOT_FOREIGN',
        `${path}/occurrence/nodeKey`,
        'Gate resolution node is foreign.',
      );
    } else if (!context.resolutionsByNode.get(record.occurrence.nodeKey)?.has(record.resolution)) {
      faults.add('SNAPSHOT_RESOLUTION', `${path}/resolution`, 'Gate resolution is foreign.');
    }
    if (gateKeys.has(record.occurrence.nodeKey)) {
      faults.add(
        'SNAPSHOT_DUPLICATE',
        `${path}/occurrence/nodeKey`,
        'Gate resolution identity is duplicated.',
      );
    }
    gateKeys.add(record.occurrence.nodeKey);
  });
};
