import {
  isDigest,
  normalizePortableValue,
  type Digest,
  type JsonValue,
  type PipelineFailure,
} from '../../foundation/index.js';
import type { PipelineCommand } from '../contracts/commands.js';
import type { PipelineState } from '../contracts/state.js';
import {
  cancelCommand,
  completeCommand,
  failCommand,
  pipelineReference,
} from '../execution/commands.js';
import { canonicalCommands } from '../identity/digests.js';
import { ownPipelineState } from './canonical.js';

export const ZERO_DIGEST: Digest = `sha256:${'0'.repeat(64)}`;

export const safeDigest = (value: unknown): Digest => (isDigest(value) ? value : ZERO_DIGEST);

export const safeInput = (value: unknown): JsonValue => {
  const result = normalizePortableValue(value);
  return result.ok ? result.value : null;
};

export const emptyRunningState = (programDigest: Digest, input: JsonValue): PipelineState =>
  ownPipelineState({
    schemaVersion: 'pipeline-state/v1',
    programDigest,
    status: 'running',
    input,
    frames: [],
    pending: [],
    resolved: [],
    runCancellation: null,
    regionCancellations: [],
    result: null,
    fault: null,
  });

export type TerminalState = {
  readonly state: PipelineState;
  readonly commands: readonly PipelineCommand[];
};

const terminal = (state: PipelineState, command: PipelineCommand | null): TerminalState =>
  Object.freeze({
    state: ownPipelineState(state),
    commands: command === null ? Object.freeze([]) : canonicalCommands([command]),
  });

export const failPipeline = (
  state: PipelineState,
  frameKey: Digest,
  failure: PipelineFailure,
): TerminalState =>
  terminal(
    {
      ...state,
      status: 'failed',
      frames: [],
      pending: [],
      resolved: [],
      regionCancellations: [],
      result: null,
      fault: failure,
    },
    failCommand(pipelineReference(state.programDigest, frameKey), failure),
  );

export const completePipeline = (
  state: PipelineState,
  frameKey: Digest,
  outcome: string,
  output: JsonValue,
): TerminalState =>
  terminal(
    {
      ...state,
      status: 'succeeded',
      frames: [],
      pending: [],
      resolved: [],
      regionCancellations: [],
      result: Object.freeze({ outcome, output }),
      fault: null,
    },
    completeCommand(pipelineReference(state.programDigest, frameKey), outcome, output),
  );

export const cancelPipeline = (
  state: PipelineState,
  frameKey: Digest,
  reasonCode: string,
): TerminalState =>
  terminal(
    {
      ...state,
      status: 'cancelled',
      frames: [],
      pending: [],
      resolved: [],
      regionCancellations: [],
      result: null,
      fault: null,
      runCancellation: Object.freeze({ reasonCode, awaiting: Object.freeze([]) }),
    },
    cancelCommand(pipelineReference(state.programDigest, frameKey), reasonCode),
  );
