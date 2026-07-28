import type { PipelineCommand, PipelineValueRecord } from '../../spec/index.js';
import type { WorkingPipelineState } from '../reduction/working-pipeline-state.js';

export const applyInitialization = (
  command: Extract<PipelineCommand, { readonly kind: 'init' }>,
  state: WorkingPipelineState,
): void => {
  state.phase = 'active';
  state.values.push(
    ...command.values.map(
      (fact): PipelineValueRecord => ({
        fact,
        source: { kind: 'init', occurrenceKey: state.occurrenceKey },
      }),
    ),
  );
  state.effects.push({
    kind: 'initialize',
    occurrenceKey: state.occurrenceKey,
    values: command.values,
  });
};
