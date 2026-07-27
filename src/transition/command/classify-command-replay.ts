import type { PipelineCommand } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';
import type { SnapshotInspection } from '../snapshot/snapshot-inspection.js';

type CommandReplay = 'new' | 'unchanged' | 'invalid';

export const classifyCommandReplay = (
  command: PipelineCommand,
  snapshot: SnapshotInspection['snapshot'],
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): CommandReplay => {
  if (command.kind === 'init') {
    if (snapshot.phase === 'uninitialized') {
      return 'new';
    }
    const existing = snapshot.values
      .filter((record) => record.source.kind === 'init')
      .map((record) => record.fact);
    if (same(existing, command.values)) {
      return 'unchanged';
    }
    faults.add('COMMAND_CONFLICT', '/command', 'Initialization conflicts with recorded content.');
    return 'invalid';
  }
  if (command.occurrence.occurrenceKey !== snapshot.occurrenceKey) {
    faults.add(
      'COMMAND_TARGET',
      '/command/occurrence/occurrenceKey',
      'Command occurrence is foreign.',
    );
    return 'invalid';
  }
  const compiled = context.nodeByKey.get(command.occurrence.nodeKey);
  const expected =
    command.kind === 'taskOutcome'
      ? 'task'
      : command.kind === 'consensusVerdict'
        ? 'consensus'
        : 'humanGate';
  if (compiled?.kind !== expected) {
    faults.add('COMMAND_TARGET', '/command/occurrence/nodeKey', 'Command target is invalid.');
    return 'invalid';
  }
  if (
    command.kind === 'consensusVerdict' &&
    !context.candidatesByNode.get(command.occurrence.nodeKey)?.has(command.candidate)
  ) {
    faults.add('COMMAND_TARGET', '/command/candidate', 'Command candidate is invalid.');
    return 'invalid';
  }
  if (
    command.kind === 'humanGateResolution' &&
    !context.resolutionsByNode.get(command.occurrence.nodeKey)?.has(command.resolution)
  ) {
    faults.add('COMMAND_TARGET', '/command/resolution', 'Command resolution is invalid.');
    return 'invalid';
  }
  const replay = existingContent(command, snapshot);
  if (replay === 'same') {
    return 'unchanged';
  }
  if (replay === 'different') {
    faults.add('COMMAND_CONFLICT', '/command', 'Command conflicts with recorded content.');
    return 'invalid';
  }
  const node = snapshot.nodes.find(
    (item) => item.occurrence.nodeKey === command.occurrence.nodeKey,
  );
  if (node?.state !== 'enabled') {
    faults.add('COMMAND_STATE', '/command/occurrence', 'Command target is not enabled.');
    return 'invalid';
  }
  const values =
    command.kind === 'taskOutcome' || command.kind === 'humanGateResolution' ? command.values : [];
  const ownedKeys = new Set(snapshot.values.map((record) => record.fact.key));
  if (values.some((fact) => ownedKeys.has(fact.key))) {
    faults.add('COMMAND_CONFLICT', '/command/values', 'Command value is already source-owned.');
    return 'invalid';
  }
  if (snapshot.values.length + values.length > 128) {
    faults.add('COMMAND_LIMIT', '/command/values', 'Resulting snapshot value limit exceeded.');
    return 'invalid';
  }
  return 'new';
};

const existingContent = (
  command: Exclude<PipelineCommand, { kind: 'init' }>,
  snapshot: SnapshotInspection['snapshot'],
): 'none' | 'same' | 'different' => {
  const key = command.occurrence.nodeKey;
  if (command.kind === 'consensusVerdict') {
    const found = snapshot.candidateVerdicts.find(
      (item) => item.occurrence.nodeKey === key && item.candidate === command.candidate,
    );
    return !found ? 'none' : found.verdict === command.verdict ? 'same' : 'different';
  }
  if (command.kind === 'humanGateResolution') {
    const found = snapshot.gateResolutions.find((item) => item.occurrence.nodeKey === key);
    if (!found) {
      return 'none';
    }
    const values = snapshot.values
      .filter(
        (item) =>
          item.source.kind === 'humanGateResolution' && item.source.occurrence.nodeKey === key,
      )
      .map((item) => item.fact);
    return found.resolution === command.resolution && same(values, command.values)
      ? 'same'
      : 'different';
  }
  const node = snapshot.nodes.find((item) => item.occurrence.nodeKey === key);
  if (node?.state !== 'terminal') {
    return 'none';
  }
  const values = snapshot.values
    .filter((item) => item.source.kind === 'taskOutcome' && item.source.occurrence.nodeKey === key)
    .map((item) => item.fact);
  return node.outcome === command.outcome && same(values, command.values) ? 'same' : 'different';
};

const same = (left: readonly unknown[], right: readonly unknown[]): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
