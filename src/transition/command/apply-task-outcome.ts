import type { PipelineCommand, PipelineValueRecord } from '../../spec/index.js';
import type { WorkingPipelineState } from '../reduction/working-pipeline-state.js';

export const applyTaskOutcome = (
  command: Extract<PipelineCommand, { readonly kind: 'taskOutcome' }>,
  state: WorkingPipelineState,
): void => {
  const index = state.nodes.findIndex(
    (node) => node.occurrence.nodeKey === command.occurrence.nodeKey,
  );
  const node = state.nodes[index];
  if (node) {
    state.nodes[index] = {
      occurrence: node.occurrence,
      state: 'terminal',
      outcome: command.outcome,
    };
  }
  state.values.push(
    ...command.values.map(
      (fact): PipelineValueRecord => ({
        fact,
        source: { kind: 'taskOutcome', occurrence: command.occurrence },
      }),
    ),
  );
  state.effects.push({
    kind: 'completeTask',
    occurrence: command.occurrence,
    outcome: command.outcome,
    values: command.values,
  });
};
