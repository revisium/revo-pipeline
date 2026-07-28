import type { PipelineCommand } from '../../spec/index.js';
import type { WorkingPipelineState } from '../reduction/working-pipeline-state.js';

export const applyConsensusVerdict = (
  command: Extract<PipelineCommand, { readonly kind: 'consensusVerdict' }>,
  state: WorkingPipelineState,
): void => {
  state.candidateVerdicts.push({
    occurrence: command.occurrence,
    candidate: command.candidate,
    verdict: command.verdict,
  });
  state.effects.push({
    kind: 'recordConsensusVerdict',
    occurrence: command.occurrence,
    candidate: command.candidate,
    verdict: command.verdict,
  });
};
