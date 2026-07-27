import type { PipelineCommand } from '../../spec/index.js';
import type { SnapshotInspection } from '../snapshot/snapshot-inspection.js';

export const classifyRecordedCommand = (
  command: Exclude<PipelineCommand, { readonly kind: 'init' }>,
  snapshot: SnapshotInspection['snapshot'],
): 'none' | 'same' | 'different' => {
  const key = command.occurrence.nodeKey;
  if (command.kind === 'consensusVerdict') {
    const found = snapshot.candidateVerdicts.find(
      (item) => item.occurrence.nodeKey === key && item.candidate === command.candidate,
    );
    if (!found) {
      return 'none';
    }
    return found.verdict === command.verdict ? 'same' : 'different';
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
    const same =
      found.resolution === command.resolution &&
      JSON.stringify(values) === JSON.stringify(command.values);
    return same ? 'same' : 'different';
  }
  const node = snapshot.nodes.find((item) => item.occurrence.nodeKey === key);
  if (node?.state !== 'terminal') {
    return 'none';
  }
  const values = snapshot.values
    .filter((item) => item.source.kind === 'taskOutcome' && item.source.occurrence.nodeKey === key)
    .map((item) => item.fact);
  const same =
    node.outcome === command.outcome && JSON.stringify(values) === JSON.stringify(command.values);
  return same ? 'same' : 'different';
};
