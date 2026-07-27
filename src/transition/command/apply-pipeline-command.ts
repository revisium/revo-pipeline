import type { PipelineCommand } from '../../spec/index.js';
import type { WorkingPipelineState } from '../reduction/working-pipeline-state.js';
import { applyConsensusVerdict } from './apply-consensus-verdict.js';
import { applyHumanGateResolution } from './apply-human-gate-resolution.js';
import { applyInitialization } from './apply-initialization.js';
import { applyTaskOutcome } from './apply-task-outcome.js';

export const applyPipelineCommand = (
  command: PipelineCommand,
  state: WorkingPipelineState,
): void => {
  if (command.kind === 'init') {
    applyInitialization(command, state);
  } else if (command.kind === 'taskOutcome') {
    applyTaskOutcome(command, state);
  } else if (command.kind === 'consensusVerdict') {
    applyConsensusVerdict(command, state);
  } else {
    applyHumanGateResolution(command, state);
  }
};
