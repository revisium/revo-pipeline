import type { Digest } from '../../foundation/index.js';
import type { PipelineCommand } from '../contracts/commands.js';
import type { CommandKey } from '../contracts/identity.js';
import type { PipelineState } from '../contracts/state.js';
import { cancelPendingCommand, pipelineReference } from '../execution/commands.js';
import { canonicalCommands } from '../identity/digests.js';
import { ownPipelineState } from '../state/canonical.js';
import { cancelPipeline, type TerminalState } from '../state/terminal.js';

export type CancellationResult = {
  readonly state: PipelineState;
  readonly commands: readonly PipelineCommand[];
  readonly terminal: boolean;
};

const asTargets = (values: readonly Digest[]): readonly [Digest, ...Digest[]] | null => {
  const [first, ...rest] = values;
  return first === undefined ? null : [first, ...rest];
};

export const requestRunCancellation = (
  state: PipelineState,
  rootFrameKey: Digest,
  reasonCode: string,
): CancellationResult => {
  if (state.status !== 'running' || state.runCancellation !== null) {
    return Object.freeze({ state, commands: Object.freeze([]), terminal: false });
  }
  const awaiting = Object.freeze(state.pending.map(({ commandKey }) => commandKey));
  if (awaiting.length === 0) {
    const result = cancelPipeline(state, rootFrameKey, reasonCode);
    return Object.freeze({ ...result, terminal: true });
  }
  const targets = asTargets(awaiting);
  const command =
    targets === null
      ? null
      : cancelPendingCommand(
          pipelineReference(state.programDigest, rootFrameKey),
          targets,
          reasonCode,
        );
  const cancelling = ownPipelineState({
    ...state,
    status: 'cancelling',
    runCancellation: Object.freeze({ reasonCode, awaiting }),
  });
  return Object.freeze({
    state: cancelling,
    commands: command === null ? Object.freeze([]) : canonicalCommands([command]),
    terminal: false,
  });
};

const withoutKey = (values: readonly CommandKey[], commandKey: CommandKey): readonly CommandKey[] =>
  values.includes(commandKey)
    ? Object.freeze(values.filter((value) => value !== commandKey))
    : values;

export const acknowledgeCancellation = (
  state: PipelineState,
  commandKey: CommandKey,
): PipelineState => {
  const runCancellation =
    state.runCancellation === null
      ? null
      : Object.freeze({
          ...state.runCancellation,
          awaiting: withoutKey(state.runCancellation.awaiting, commandKey),
        });
  const regionCancellations = state.regionCancellations.map((cancellation) =>
    Object.freeze({
      ...cancellation,
      awaiting: withoutKey(cancellation.awaiting, commandKey),
    }),
  );
  return ownPipelineState({ ...state, runCancellation, regionCancellations });
};

export const finishAcknowledgedCancellation = (
  state: PipelineState,
  rootFrameKey: Digest,
): TerminalState | null => {
  const runCancellation = state.runCancellation;
  if (
    state.status !== 'cancelling' ||
    runCancellation === null ||
    runCancellation.awaiting.length > 0 ||
    state.regionCancellations.some(({ awaiting }) => awaiting.length > 0)
  ) {
    return null;
  }
  return cancelPipeline(state, rootFrameKey, runCancellation.reasonCode);
};
