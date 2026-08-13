import { describe, expect, it } from 'vitest';

import { compareUnicodeCodePoints } from '../../src/foundation/index.js';
import {
  advancePipeline,
  createInitialPipelineState,
  type PipelineCommand,
  type PipelineState,
} from '../../src/kernel/index.js';
import { hydratePipelineState } from '../support/kernel-internal.js';
import {
  nestedSelectedMapCancellationProgram,
  nestedSelectedParallelCancellationProgram,
} from '../support/nested-cleanup-builders.js';

type ActivityCommand = Extract<PipelineCommand, { readonly kind: 'dispatchActivity' }>;

const activityFor = (commands: readonly PipelineCommand[], requirementKey: string) => {
  const command = commands.find(
    (candidate): candidate is ActivityCommand =>
      candidate.kind === 'dispatchActivity' && candidate.requirementKey === requirementKey,
  );
  if (command === undefined) {
    throw new TypeError(`Expected activity ${requirementKey}.`);
  }
  return command;
};

const activityForItem = (
  state: PipelineState,
  commands: readonly PipelineCommand[],
  itemKey: string,
): ActivityCommand => {
  const frame = state.frames.find(
    (candidate) => candidate.kind === 'mapItem' && candidate.itemKey === itemKey,
  );
  const command = commands.find(
    (candidate): candidate is ActivityCommand =>
      candidate.kind === 'dispatchActivity' && candidate.ref.frameKey === frame?.key,
  );
  if (command === undefined) {
    throw new TypeError(`Expected activity for map item ${itemKey}.`);
  }
  return command;
};

const expectCancellationTargets = (
  commands: readonly PipelineCommand[],
  targets: readonly string[],
): void => {
  const command = commands[0];
  expect(command?.kind).toBe('cancelPending');
  if (command?.kind !== 'cancelPending') {
    throw new TypeError('Expected a cancellation command.');
  }
  expect(command.targets).toEqual([...targets].sort(compareUnicodeCodePoints));
};

const succeeded = (command: ActivityCommand, output: unknown = {}) => ({
  kind: 'activitySucceeded' as const,
  commandKey: command.key,
  ref: command.ref,
  output,
});

const cancelled = (command: ActivityCommand) => ({
  kind: 'activityCancelled' as const,
  commandKey: command.key,
  ref: command.ref,
});

const roundTrip = (state: PipelineState): PipelineState => {
  const hydrated = hydratePipelineState(JSON.parse(JSON.stringify(state)));
  if (hydrated === null) {
    throw new TypeError('Expected the cleanup state to survive hydration.');
  }
  return hydrated;
};

describe('nested cleanup preserves an existing coordination selection', () => {
  it('keeps the selected fail-fast map failure across two parent cancellation acknowledgements', () => {
    const bundle = nestedSelectedMapCancellationProgram();
    const initial = createInitialPipelineState(bundle, {});
    const winner = activityFor(initial.commands, 'outer-winner');
    const a = activityForItem(initial.state, initial.commands, 'a');
    const b = activityForItem(initial.state, initial.commands, 'b');
    const c = activityForItem(initial.state, initial.commands, 'c');

    const failed = advancePipeline(bundle, initial.state, {
      kind: 'activityFailed',
      commandKey: a.key,
      ref: a.ref,
      errorCode: 'FIRST_FAILURE',
    });
    expect(failed.state.frames.find(({ kind }) => kind === 'map')).toMatchObject({
      selected: 'failed',
      selectedFailureItemKey: 'a',
      status: 'draining',
    });

    const requested = advancePipeline(bundle, failed.state, succeeded(winner));
    expectCancellationTargets(requested.commands, [b.key, c.key]);

    const first = advancePipeline(bundle, requested.state, cancelled(b));
    expect(first.commands).toEqual([]);
    const map = first.state.frames.find(({ kind }) => kind === 'map');
    expect(map).toMatchObject({
      selected: 'failed',
      selectedFailureItemKey: 'a',
    });
    if (map?.kind !== 'map') {
      throw new TypeError('Expected the live nested map.');
    }
    expect(map.completedItems.find(({ itemKey }) => itemKey === 'a')).toEqual({
      itemKey: 'a',
      status: 'failed',
      output: null,
      failure: { code: 'FIRST_FAILURE', path: '' },
    });

    const completed = advancePipeline(bundle, roundTrip(first.state), cancelled(c));
    expect(completed).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [], regionCancellations: [] },
      commands: [{ kind: 'complete' }],
    });
  });

  it.each([
    ['generic', 'completed'],
    ['votes', 'approved'],
  ] as const)(
    'keeps a selected %s drain-parallel result during parent cleanup',
    (mode, selected) => {
      const bundle = nestedSelectedParallelCancellationProgram(mode);
      const initial = createInitialPipelineState(bundle, {});
      const winner = activityFor(initial.commands, 'outer-winner');
      const prefix = mode === 'votes' ? 'binding' : 'nested-parallel';
      const a = activityFor(initial.commands, `${prefix}-a`);
      const b = activityFor(initial.commands, `${prefix}-b`);
      const c = activityFor(initial.commands, `${prefix}-c`);

      const innerSelected = advancePipeline(
        bundle,
        initial.state,
        succeeded(a, mode === 'votes' ? 'approve' : {}),
      );
      expect(
        innerSelected.state.frames.find(
          (frame) => frame.kind === 'parallel' && frame.parentFrameKey !== null,
        ),
      ).toMatchObject({ selected, status: 'draining' });

      const requested = advancePipeline(bundle, innerSelected.state, succeeded(winner));
      expectCancellationTargets(requested.commands, [b.key, c.key]);
      const first = advancePipeline(bundle, requested.state, cancelled(b));
      expect(first.commands).toEqual([]);
      expect(
        first.state.frames.find(
          (frame) => frame.kind === 'parallel' && frame.parentFrameKey !== null,
        ),
      ).toMatchObject({ selected, status: 'draining' });

      const completed = advancePipeline(bundle, roundTrip(first.state), cancelled(c));
      expect(completed).toMatchObject({
        state: { status: 'succeeded', frames: [], pending: [], regionCancellations: [] },
        commands: [{ kind: 'complete' }],
      });
    },
  );
});
