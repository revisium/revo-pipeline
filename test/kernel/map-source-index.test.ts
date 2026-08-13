import { describe, expect, it } from 'vitest';

import {
  advancePipeline,
  createInitialPipelineState,
  type MapMachineFrame,
} from '../../src/kernel/index.js';
import { hydratePipelineState } from '../support/kernel-internal.js';
import { reverseNestedKeyMapProgram } from '../support/large-map-builders.js';
import { activityMapProgram, commandForItem } from '../support/structured-kernel-builders.js';

const mutateOwner = (
  state: ReturnType<typeof createInitialPipelineState>['state'],
  mutate: (owner: MapMachineFrame) => unknown,
): unknown => ({
  ...state,
  frames: state.frames.map((frame) => (frame.kind === 'map' ? mutate(frame) : frame)),
});

describe('map source index relation', () => {
  it('persists an empty aligned relation', () => {
    const bundle = reverseNestedKeyMapProgram(0);
    expect(createInitialPipelineState(bundle, {})).toMatchObject({
      state: { status: 'succeeded' },
      commands: [{ kind: 'complete' }],
    });
  });

  it('hydrates a valid unsorted source-index permutation', () => {
    const bundle = reverseNestedKeyMapProgram(3);
    const initial = createInitialPipelineState(bundle, {});
    const owner = initial.state.frames.find((frame) => frame.kind === 'map');
    expect(owner).toMatchObject({
      itemKeys: ['item-0000', 'item-0001', 'item-0002'],
      itemSourceIndexes: [2, 1, 0],
    });
    expect(hydratePipelineState(JSON.parse(JSON.stringify(initial.state)))).not.toBeNull();
  });

  it.each([
    [
      'missing field',
      (owner: MapMachineFrame) => {
        const { itemSourceIndexes: omitted, ...remaining } = owner;
        void omitted;
        return remaining;
      },
    ],
    ['wrong length', (owner: MapMachineFrame) => ({ ...owner, itemSourceIndexes: [0] })],
    ['duplicate', (owner: MapMachineFrame) => ({ ...owner, itemSourceIndexes: [0, 0] })],
    ['out of range', (owner: MapMachineFrame) => ({ ...owner, itemSourceIndexes: [0, 2] })],
    ['negative', (owner: MapMachineFrame) => ({ ...owner, itemSourceIndexes: [-1, 1] })],
    ['noninteger', (owner: MapMachineFrame) => ({ ...owner, itemSourceIndexes: [0, 0.5] })],
  ] as const)('rejects a %s source-index relation', (_name, mutate) => {
    const initial = createInitialPipelineState(activityMapProgram({ kind: 'collect' }), {});
    expect(hydratePipelineState(mutateOwner(initial.state, mutate))).toBeNull();
  });

  it('fails invariant without dispatch when a valid permutation points at the wrong item', () => {
    const bundle = activityMapProgram({ kind: 'collect' });
    const initial = createInitialPipelineState(bundle, {});
    const corrupted = hydratePipelineState(
      mutateOwner(initial.state, (owner) => ({ ...owner, itemSourceIndexes: [0, 1] })),
    );
    if (corrupted === null) {
      throw new TypeError('Expected a schema-valid corrupted relation.');
    }
    const command = commandForItem(corrupted, initial.commands, 'a');
    const advanced = advancePipeline(bundle, corrupted, {
      kind: 'activitySucceeded',
      commandKey: command.key,
      ref: command.ref,
      output: {},
    });
    expect(advanced).toMatchObject({
      state: { status: 'failed', fault: { code: 'INVARIANT_PROGRAM_STATE' } },
      commands: [{ kind: 'fail', code: 'INVARIANT_PROGRAM_STATE' }],
    });
    expect(advanced.commands.some(({ kind }) => kind === 'dispatchActivity')).toBe(false);
  });
});
