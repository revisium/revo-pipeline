import { describe, expect, it } from 'vitest';

import {
  advancePipeline,
  createInitialPipelineState,
  type MapMachineFrame,
} from '../../src/kernel/index.js';
import { hydratePipelineState } from '../support/kernel-internal.js';
import { commandForItem, failFastMapProgram } from '../support/structured-kernel-builders.js';

const failedEvent = (command: ReturnType<typeof commandForItem>, errorCode: string) => ({
  kind: 'activityFailed' as const,
  commandKey: command.key,
  ref: command.ref,
  errorCode,
});

const selectedState = (remaining: 'drain' | 'cancel') => {
  const bundle = failFastMapProgram(remaining);
  const initial = createInitialPipelineState(bundle, {});
  const a = commandForItem(initial.state, initial.commands, 'a');
  const z = commandForItem(initial.state, initial.commands, 'z');
  const selected = advancePipeline(bundle, initial.state, failedEvent(z, 'Z_FAILED'));
  if (selected.kind !== 'advanced') {
    throw new TypeError('Expected the z failure to advance the map.');
  }
  return { bundle, a, z, selected };
};

describe.each(['drain', 'cancel'] as const)('fail-fast map %s', (remaining) => {
  it('preserves the first event-causal failure across clone and cleanup', () => {
    const { bundle, a, selected } = selectedState(remaining);
    const owner = selected.state.frames.find(({ kind }) => kind === 'map');
    expect(owner).toMatchObject({
      kind: 'map',
      selected: 'failed',
      selectedFailureItemKey: 'z',
      completedItems: [{ itemKey: 'z', failure: { code: 'Z_FAILED', path: '' } }],
    });
    expect(selected.commands.map(({ kind }) => kind)).toEqual(
      remaining === 'cancel' ? ['cancelPending'] : [],
    );

    const clonedInput: unknown = JSON.parse(JSON.stringify(selected.state));
    const cloned = hydratePipelineState(clonedInput);
    if (cloned === null) {
      throw new TypeError('Expected the serialized map state to hydrate.');
    }
    const completed = advancePipeline(bundle, cloned, failedEvent(a, 'A_FAILED'));
    expect(completed).toMatchObject({
      kind: 'advanced',
      state: {
        status: 'succeeded',
        result: { outcome: 'failed', output: { code: 'Z_FAILED', path: '' } },
      },
    });
  });
});

describe('map selected failure hydration', () => {
  const mutateOwner = (
    state: ReturnType<typeof selectedState>['selected']['state'],
    mutate: (owner: MapMachineFrame) => unknown,
  ): unknown => ({
    ...state,
    frames: state.frames.map((frame) => (frame.kind === 'map' ? mutate(frame) : frame)),
  });

  it.each([
    [
      'missing field',
      (owner: MapMachineFrame) => {
        const { selectedFailureItemKey: omitted, ...remaining } = owner;
        void omitted;
        return remaining;
      },
    ],
    ['failed with null', (owner: MapMachineFrame) => ({ ...owner, selectedFailureItemKey: null })],
    ['nonfailed with key', (owner: MapMachineFrame) => ({ ...owner, selected: 'completed' })],
    ['unknown key', (owner: MapMachineFrame) => ({ ...owner, selectedFailureItemKey: 'unknown' })],
    [
      'key to nonfailure',
      (owner: MapMachineFrame) => ({
        ...owner,
        completedItems: [{ itemKey: 'z', status: 'cancelled', output: null, failure: null }],
      }),
    ],
  ] as const)('rejects %s', (_name, mutate) => {
    const { selected } = selectedState('drain');
    expect(hydratePipelineState(mutateOwner(selected.state, mutate))).toBeNull();
  });
});

it('retains a failed map selection after requested item cleanup cancellation', () => {
  const { bundle, a, selected } = selectedState('cancel');
  const completed = advancePipeline(bundle, selected.state, {
    kind: 'activityCancelled',
    commandKey: a.key,
    ref: a.ref,
  });
  expect(completed).toMatchObject({
    state: {
      status: 'succeeded',
      result: { outcome: 'failed', output: { code: 'Z_FAILED', path: '' } },
    },
  });
});
