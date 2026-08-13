import { describe, expect, it } from 'vitest';

import { compareUnicodeCodePoints } from '../../src/foundation/index.js';
import {
  advancePipeline,
  createInitialPipelineState,
  type PipelineCommand,
} from '../../src/kernel/index.js';
import { nestedCancellationProgram } from '../support/structured-cancellation-builders.js';
import { commandForItem, failFastMapProgram } from '../support/structured-kernel-builders.js';

const cancellationEvent = (command: ReturnType<typeof commandForItem>) => ({
  kind: 'activityCancelled' as const,
  commandKey: command.key,
  ref: command.ref,
});

describe('kernel coordination cancellation', () => {
  it('emits one sorted run intent and waits for every acknowledgement', () => {
    const bundle = failFastMapProgram('drain');
    const initial = createInitialPipelineState(bundle, {});
    const a = commandForItem(initial.state, initial.commands, 'a');
    const z = commandForItem(initial.state, initial.commands, 'z');
    const requested = advancePipeline(bundle, initial.state, {
      kind: 'cancelRequested',
      reasonCode: 'USER',
    });
    expect(requested).toMatchObject({
      kind: 'advanced',
      state: { status: 'cancelling' },
      commands: [{ kind: 'cancelPending', reasonCode: 'USER' }],
    });
    const command = requested.commands[0];
    expect(command?.kind).toBe('cancelPending');
    if (command?.kind !== 'cancelPending') {
      return;
    }
    expect(command.targets).toEqual([a.key, z.key].sort(compareUnicodeCodePoints));

    const first = advancePipeline(bundle, requested.state, cancellationEvent(a));
    expect(first).toMatchObject({
      kind: 'advanced',
      state: { status: 'cancelling', runCancellation: { awaiting: [z.key] } },
      commands: [],
    });
    const final = advancePipeline(bundle, first.state, cancellationEvent(z));
    expect(final).toMatchObject({
      kind: 'advanced',
      state: { status: 'cancelled', frames: [], pending: [] },
      commands: [{ kind: 'cancel', reasonCode: 'USER' }],
    });
  });

  it('rejects a cancellation membership owned by a non-coordination frame', () => {
    const bundle = failFastMapProgram('cancel');
    const initial = createInitialPipelineState(bundle, {});
    const z = commandForItem(initial.state, initial.commands, 'z');
    const owner = initial.state.frames.find(({ kind }) => kind === 'map');
    const item = initial.state.frames.find(
      (frame) => frame.kind === 'mapItem' && frame.itemKey === 'z',
    );
    if (owner?.kind !== 'map' || item?.kind !== 'mapItem') {
      throw new TypeError('Expected live map owner and z item.');
    }
    const overlapping = {
      ...initial.state,
      regionCancellations: [owner.key, item.key]
        .sort(compareUnicodeCodePoints)
        .map((frameKey) => ({ frameKey, reasonCode: 'OVERLAP', awaiting: [z.key] })),
    };
    const advanced = advancePipeline(bundle, overlapping, {
      kind: 'activityFailed',
      commandKey: z.key,
      ref: z.ref,
      errorCode: 'Z_FAILED',
    });
    expect(advanced).toMatchObject({
      kind: 'advanced',
      state: { status: 'failed', fault: { code: 'INVARIANT_PROGRAM_STATE' } },
      commands: [{ kind: 'fail', code: 'INVARIANT_PROGRAM_STATE' }],
    });
  });

  it('creates no cancellation artifact for fail-fast drain', () => {
    const bundle = failFastMapProgram('drain');
    const initial = createInitialPipelineState(bundle, {});
    const z = commandForItem(initial.state, initial.commands, 'z');
    const selected = advancePipeline(bundle, initial.state, {
      kind: 'activityFailed',
      commandKey: z.key,
      ref: z.ref,
      errorCode: 'Z_FAILED',
    });
    expect(selected).toMatchObject({
      kind: 'advanced',
      state: { regionCancellations: [] },
      commands: [],
    });
  });

  it.each(['activityFailed', 'activitySucceeded'] as const)(
    'retains a late global %s route without activating it',
    (kind) => {
      const bundle = nestedCancellationProgram('callRegion');
      const initial = createInitialPipelineState(bundle, {});
      const dispatched = initial.commands.filter(
        (command): command is Extract<PipelineCommand, { readonly kind: 'dispatchActivity' }> =>
          command.kind === 'dispatchActivity',
      );
      const lateCommand = dispatched.find(
        ({ requirementKey }) => requirementKey === 'operation-800',
      );
      const finalCommand = dispatched.find(
        ({ requirementKey }) => requirementKey === 'operation-600',
      );
      if (lateCommand === undefined || finalCommand === undefined) {
        throw new TypeError('Expected global cancellation activities.');
      }
      const requested = advancePipeline(bundle, initial.state, {
        kind: 'cancelRequested',
        reasonCode: 'ORIGINAL',
      });
      const late = advancePipeline(bundle, requested.state, {
        kind,
        commandKey: lateCommand.key,
        ref: lateCommand.ref,
        ...(kind === 'activityFailed' ? { errorCode: 'LATE_FAILURE' } : { output: {} }),
      });
      const item = late.state.frames.find((frame) => frame.key === lateCommand.ref.frameKey);
      const pending = initial.state.pending.find(
        ({ commandKey }) => commandKey === lateCommand.key,
      );
      if (pending === undefined) {
        throw new TypeError('Expected original pending operation.');
      }
      expect(late).toMatchObject({
        state: { status: 'cancelling', runCancellation: { awaiting: [finalCommand.key] } },
        commands: [],
      });
      expect(item).toMatchObject({
        nodeResults: {
          [pending.ref.nodeId]:
            kind === 'activityFailed'
              ? { status: 'failed', failure: { code: 'LATE_FAILURE', path: '' } }
              : { status: 'succeeded', output: {} },
        },
      });
      expect(item !== undefined && 'ready' in item && item.ready).toHaveLength(1);

      const final = advancePipeline(bundle, late.state, cancellationEvent(finalCommand));
      expect(final).toMatchObject({
        state: { status: 'cancelled', frames: [], pending: [] },
        commands: [{ kind: 'cancel', reasonCode: 'ORIGINAL' }],
      });
      expect(
        final.commands.some(
          ({ kind: commandKind }) => commandKind === 'fail' || commandKind === 'complete',
        ),
      ).toBe(false);
    },
  );
});
