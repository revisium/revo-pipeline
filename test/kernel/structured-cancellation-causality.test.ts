import { describe, expect, it } from 'vitest';

import { compareUnicodeCodePoints } from '../../src/foundation/index.js';
import {
  advancePipeline,
  createInitialPipelineState,
  type PipelineCommand,
} from '../../src/kernel/index.js';
import {
  nestedCancellationProgram,
  type CancellationScope,
} from '../support/structured-cancellation-builders.js';

type ActivityCommand = Extract<PipelineCommand, { readonly kind: 'dispatchActivity' }>;

const activities = (commands: readonly PipelineCommand[]): readonly ActivityCommand[] =>
  commands.filter((command): command is ActivityCommand => command.kind === 'dispatchActivity');

const cancellationPair = (commands: readonly PipelineCommand[]) => {
  const values = activities(commands);
  const winner = values.find(({ requirementKey }) => requirementKey === 'operation-600');
  const descendant = values.find(({ requirementKey }) => requirementKey === 'operation-800');
  if (winner === undefined || descendant === undefined) {
    throw new TypeError('Expected winner and cancellable descendant operations.');
  }
  return { winner, descendant };
};

const event = (
  command: ActivityCommand,
  kind: 'activityCancelled' | 'activityFailed' | 'activitySucceeded',
) => ({
  kind,
  commandKey: command.key,
  ref: command.ref,
  ...(kind === 'activityFailed' ? { errorCode: 'LATE_FAILURE' } : {}),
  ...(kind === 'activitySucceeded' ? { output: {} } : {}),
});

const scopes: readonly CancellationScope[] = [
  'callRegion',
  'mapItem',
  'parallelBranch',
  'repeatBody',
];

describe('requested structured cancellation causality', () => {
  it.each(scopes)('bypasses the %s author cancelled route during cleanup', (scope) => {
    const bundle = nestedCancellationProgram(scope);
    const initial = createInitialPipelineState(bundle, {});
    const { winner, descendant } = cancellationPair(initial.commands);
    const selected = advancePipeline(bundle, initial.state, event(winner, 'activitySucceeded'));
    expect(selected.commands).toMatchObject([{ kind: 'cancelPending', targets: [descendant.key] }]);
    const completed = advancePipeline(
      bundle,
      selected.state,
      event(descendant, 'activityCancelled'),
    );
    expect(completed).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [], regionCancellations: [] },
      commands: [{ kind: 'complete' }],
    });
    expect(completed.commands.some(({ kind }) => kind === 'dispatchActivity')).toBe(false);
  });

  it.each(
    scopes.flatMap((scope) =>
      (['activityFailed', 'activitySucceeded'] as const).map((kind) => [scope, kind] as const),
    ),
  )('preserves a real late %s result inside %s cleanup', (scope, kind) => {
    const bundle = nestedCancellationProgram(scope);
    const initial = createInitialPipelineState(bundle, {});
    const { winner, descendant } = cancellationPair(initial.commands);
    const selected = advancePipeline(bundle, initial.state, event(winner, 'activitySucceeded'));
    const completed = advancePipeline(bundle, selected.state, event(descendant, kind));
    expect(completed).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [], regionCancellations: [] },
      commands: [{ kind: 'complete' }],
    });
    expect(completed.commands.some(({ kind: commandKind }) => commandKind === 'fail')).toBe(false);
    expect(
      completed.commands.some(({ kind: commandKind }) => commandKind === 'dispatchActivity'),
    ).toBe(false);
  });

  it('propagates through an overlapping inner-to-outer owner chain', () => {
    const bundle = nestedCancellationProgram('mapItem');
    const initial = createInitialPipelineState(bundle, {});
    const { winner, descendant } = cancellationPair(initial.commands);
    const selected = advancePipeline(bundle, initial.state, event(winner, 'activitySucceeded'));
    const inner = selected.state.frames.find(({ kind }) => kind === 'map');
    if (inner?.kind !== 'map') {
      throw new TypeError('Expected nested map owner.');
    }
    const overlapping = {
      ...selected.state,
      frames: selected.state.frames.map((frame) =>
        frame.key === inner.key
          ? { ...inner, selected: 'cancelled' as const, status: 'cancelling' as const }
          : frame,
      ),
      regionCancellations: [
        ...selected.state.regionCancellations,
        { frameKey: inner.key, reasonCode: 'INNER', awaiting: [descendant.key] },
      ].sort((left, right) => compareUnicodeCodePoints(left.frameKey, right.frameKey)),
    };
    const completed = advancePipeline(bundle, overlapping, event(descendant, 'activityFailed'));
    expect(completed).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [], regionCancellations: [] },
      commands: [{ kind: 'complete' }],
    });
    expect(completed.commands.some(({ kind }) => kind === 'dispatchActivity')).toBe(false);
  });

  it('lets overlapping run cancellation suppress the outer selected continuation', () => {
    const bundle = nestedCancellationProgram('repeatBody');
    const initial = createInitialPipelineState(bundle, {});
    const { winner, descendant } = cancellationPair(initial.commands);
    const selected = advancePipeline(bundle, initial.state, event(winner, 'activitySucceeded'));
    const requested = advancePipeline(bundle, selected.state, {
      kind: 'cancelRequested',
      reasonCode: 'RUN_WINS',
    });
    expect(requested.commands).toMatchObject([{ kind: 'cancelPending' }]);

    const cancelled = advancePipeline(bundle, requested.state, event(descendant, 'activityFailed'));
    expect(cancelled).toMatchObject({
      state: { status: 'cancelled', frames: [], pending: [], regionCancellations: [] },
      commands: [{ kind: 'cancel', reasonCode: 'RUN_WINS' }],
    });
    expect(
      cancelled.commands.some(
        ({ kind }) => kind === 'dispatchActivity' || kind === 'complete' || kind === 'fail',
      ),
    ).toBe(false);
  });
});
