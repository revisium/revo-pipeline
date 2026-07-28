import type { PipelineCommand } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';
import type { SnapshotInspection } from '../snapshot/snapshot-inspection.js';
import { classifyInitializationReplay } from './classify-initialization-replay.js';
import { classifyRecordedCommand } from './classify-recorded-command.js';
import { validateCommandTarget } from './validate-command-target.js';

type CommandReplay = 'new' | 'unchanged' | 'invalid';

export const classifyCommandReplay = (
  command: PipelineCommand,
  snapshot: SnapshotInspection['snapshot'],
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): CommandReplay => {
  if (command.kind === 'init') {
    return classifyInitializationReplay(command, snapshot, faults);
  }
  if (!validateCommandTarget(command, snapshot, context, faults)) {
    return 'invalid';
  }
  const replay = classifyRecordedCommand(command, snapshot);
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
