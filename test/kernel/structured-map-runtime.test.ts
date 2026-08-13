import { describe, expect, it } from 'vitest';

import { advancePipeline, createInitialPipelineState } from '../../src/kernel/index.js';
import { activityMapProgram, commandForItem } from '../support/structured-kernel-builders.js';

const succeeded = (command: ReturnType<typeof commandForItem>) => ({
  kind: 'activitySucceeded' as const,
  commandKey: command.key,
  ref: command.ref,
  output: {},
});

const failed = (command: ReturnType<typeof commandForItem>) => ({
  kind: 'activityFailed' as const,
  commandKey: command.key,
  ref: command.ref,
  errorCode: 'ITEM_FAILED',
});

describe('structured map refill outcomes', () => {
  it.each([
    ['succeeded', succeeded],
    ['failed under collect', failed],
  ] as const)('refills after an item %s', (_name, eventFor) => {
    const bundle = activityMapProgram({ kind: 'collect' });
    const initial = createInitialPipelineState(bundle, {});
    const a = commandForItem(initial.state, initial.commands, 'a');
    const refilled = advancePipeline(bundle, initial.state, eventFor(a));
    const z = commandForItem(refilled.state, refilled.commands, 'z');
    expect(refilled).toMatchObject({
      state: { status: 'running' },
      commands: [{ kind: 'dispatchActivity' }],
    });
    const completed = advancePipeline(bundle, refilled.state, succeeded(z));
    expect(completed).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [] },
      commands: [{ kind: 'complete' }],
    });
  });

  it('retains an isolated item cancellation without cancelling the map', () => {
    const bundle = activityMapProgram({ kind: 'collect' });
    const initial = createInitialPipelineState(bundle, {});
    const a = commandForItem(initial.state, initial.commands, 'a');
    const refilled = advancePipeline(bundle, initial.state, {
      kind: 'activityCancelled',
      commandKey: a.key,
      ref: a.ref,
    });
    const z = commandForItem(refilled.state, refilled.commands, 'z');
    const owner = refilled.state.frames.find((frame) => frame.kind === 'map');
    expect(owner).toMatchObject({
      kind: 'map',
      selected: null,
      completedItems: [{ itemKey: 'a', status: 'cancelled' }],
    });
    const completed = advancePipeline(bundle, refilled.state, succeeded(z));
    expect(completed).toMatchObject({
      state: { status: 'succeeded', result: { outcome: 'ok' } },
      commands: [{ kind: 'complete' }],
    });
  });

  it('finishes fail-fast cancel immediately when only unstarted items remain', () => {
    const bundle = activityMapProgram({ kind: 'failFast', remaining: 'cancel' });
    const initial = createInitialPipelineState(bundle, {});
    const a = commandForItem(initial.state, initial.commands, 'a');
    const completed = advancePipeline(bundle, initial.state, failed(a));
    expect(completed).toMatchObject({
      state: { status: 'succeeded', result: { outcome: 'failed' }, regionCancellations: [] },
      commands: [{ kind: 'complete' }],
    });
  });
});
