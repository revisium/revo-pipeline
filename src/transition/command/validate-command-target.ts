import type { PipelineCommand } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';
import type { SnapshotInspection } from '../snapshot/snapshot-inspection.js';

export const validateCommandTarget = (
  command: Exclude<PipelineCommand, { readonly kind: 'init' }>,
  snapshot: SnapshotInspection['snapshot'],
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): boolean => {
  if (command.occurrence.occurrenceKey !== snapshot.occurrenceKey) {
    faults.add(
      'COMMAND_TARGET',
      '/command/occurrence/occurrenceKey',
      'Command occurrence is foreign.',
    );
    return false;
  }
  const compiled = context.nodeByKey.get(command.occurrence.nodeKey);
  let expected: 'task' | 'consensus' | 'humanGate' = 'humanGate';
  if (command.kind === 'taskOutcome') {
    expected = 'task';
  } else if (command.kind === 'consensusVerdict') {
    expected = 'consensus';
  }
  if (compiled?.kind !== expected) {
    faults.add('COMMAND_TARGET', '/command/occurrence/nodeKey', 'Command target is invalid.');
    return false;
  }
  if (
    command.kind === 'consensusVerdict' &&
    !context.candidatesByNode.get(command.occurrence.nodeKey)?.has(command.candidate)
  ) {
    faults.add('COMMAND_TARGET', '/command/candidate', 'Command candidate is invalid.');
    return false;
  }
  if (
    command.kind === 'humanGateResolution' &&
    !context.resolutionsByNode.get(command.occurrence.nodeKey)?.has(command.resolution)
  ) {
    faults.add('COMMAND_TARGET', '/command/resolution', 'Command resolution is invalid.');
    return false;
  }
  return true;
};
