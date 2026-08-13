import { describe, expect, it } from 'vitest';

import {
  advancePipeline,
  createInitialPipelineState,
  type MapItemResult,
} from '../../src/kernel/index.js';
import { hydratePipelineState } from '../support/kernel-internal.js';
import { activityMapProgram, commandForItem } from '../support/structured-kernel-builders.js';

const stateWithCompletedItem = () => {
  const bundle = activityMapProgram({ kind: 'collect' });
  const initial = createInitialPipelineState(bundle, {});
  const command = commandForItem(initial.state, initial.commands, 'a');
  const advanced = advancePipeline(bundle, initial.state, {
    kind: 'activitySucceeded',
    commandKey: command.key,
    ref: command.ref,
    output: {},
  });
  return advanced.state;
};

const replaceCompletedItem = (item: unknown): unknown => {
  const state = stateWithCompletedItem();
  return {
    ...state,
    frames: state.frames.map((frame) =>
      frame.kind === 'map' ? { ...frame, completedItems: [item] } : frame,
    ),
  };
};

const failure = { code: 'ITEM_FAILED', path: '' } as const;

describe('map item result contract', () => {
  it.each([
    { itemKey: 'a', status: 'succeeded', output: null, failure: null },
    { itemKey: 'a', status: 'failed', output: null, failure },
    { itemKey: 'a', status: 'cancelled', output: null, failure: null },
  ] satisfies readonly MapItemResult[])('hydrates the exact $status variant', (item) => {
    expect(hydratePipelineState(replaceCompletedItem(item))).not.toBeNull();
  });

  it.each([
    ['succeeded/failure', { itemKey: 'a', status: 'succeeded', output: null, failure }],
    ['failed/output', { itemKey: 'a', status: 'failed', output: {}, failure }],
    ['failed/empty', { itemKey: 'a', status: 'failed', output: null, failure: null }],
    ['failed/both wrong', { itemKey: 'a', status: 'failed', output: {}, failure: null }],
    ['cancelled/output', { itemKey: 'a', status: 'cancelled', output: {}, failure: null }],
    ['cancelled/failure', { itemKey: 'a', status: 'cancelled', output: null, failure }],
    ['cancelled/both', { itemKey: 'a', status: 'cancelled', output: {}, failure }],
  ] as const)('rejects the invalid %s pairing', (unusedName, item) => {
    expect(hydratePipelineState(replaceCompletedItem(item))).toBeNull();
  });

  it('rejects simultaneous full pending, active, and completed capacity', () => {
    const state = stateWithCompletedItem();
    const invalid = {
      ...state,
      frames: state.frames.map((frame) =>
        frame.kind === 'map'
          ? {
              ...frame,
              pendingItemKeys: frame.itemKeys,
              activeItemKeys: frame.itemKeys,
              completedItems: frame.itemKeys.map((itemKey) => ({
                itemKey,
                status: 'failed',
                output: null,
                failure,
              })),
            }
          : frame,
      ),
    };
    expect(hydratePipelineState(invalid)).toBeNull();
  });
});
