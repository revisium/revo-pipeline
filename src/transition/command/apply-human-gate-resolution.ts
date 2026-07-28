import type { PipelineCommand, PipelineValueRecord } from '../../spec/index.js';
import type { WorkingPipelineState } from '../reduction/working-pipeline-state.js';

export const applyHumanGateResolution = (
  command: Extract<PipelineCommand, { readonly kind: 'humanGateResolution' }>,
  state: WorkingPipelineState,
): void => {
  state.gateResolutions.push({
    occurrence: command.occurrence,
    resolution: command.resolution,
  });
  state.values.push(
    ...command.values.map(
      (fact): PipelineValueRecord => ({
        fact,
        source: { kind: 'humanGateResolution', occurrence: command.occurrence },
      }),
    ),
  );
  state.effects.push({
    kind: 'resolveHumanGate',
    occurrence: command.occurrence,
    resolution: command.resolution,
    values: command.values,
  });
};
