import type {
  ActivateDecision,
  NoopDecision,
  SelectDecision,
  TerminalDecision,
  WaitDecision,
} from '../spec/index.js';
import type { RejectDecision } from './reject-decision.js';

export type PipelineDecision =
  | ActivateDecision
  | SelectDecision
  | WaitDecision
  | TerminalDecision
  | NoopDecision
  | RejectDecision;
