import { describe, expect, it } from 'vitest';

import {
  advancePipeline,
  createInitialPipelineState,
  type PipelineCommand,
  type PipelineState,
} from '../../src/kernel/index.js';
import { unstartedParallelProgram } from '../support/parallel-unstarted-builders.js';
import {
  parallelActivityProgram,
  synchronousParallelProgram,
} from '../support/structured-kernel-builders.js';

type ActivityCommand = Extract<PipelineCommand, { readonly kind: 'dispatchActivity' }>;

const branchCommands = (
  state: PipelineState,
  commands: readonly PipelineCommand[],
): Readonly<Record<string, ActivityCommand>> => {
  const frames = new Map(
    state.frames
      .filter((frame) => frame.kind === 'parallelBranch')
      .map((frame) => [frame.key, frame.branchKey]),
  );
  return Object.fromEntries(
    commands
      .filter((command): command is ActivityCommand => command.kind === 'dispatchActivity')
      .map((command) => [frames.get(command.ref.frameKey), command])
      .filter((entry): entry is [string, ActivityCommand] => entry[0] !== undefined),
  );
};

const terminalEvent = (
  command: ActivityCommand,
  kind: 'activityFailed' | 'activityCancelled' | 'activitySucceeded',
  output: unknown = {},
) => ({
  kind,
  commandKey: command.key,
  ref: command.ref,
  ...(kind === 'activityFailed' ? { errorCode: 'BRANCH_FAILED' } : {}),
  ...(kind === 'activitySucceeded' ? { output } : {}),
});

describe('structured parallel runtime outcomes', () => {
  it.each([
    ['activityFailed', 'failed'],
    ['activityCancelled', 'failed'],
  ] as const)('drains siblings after a %s branch', (kind, selection) => {
    const bundle = parallelActivityProgram('drain');
    const initial = createInitialPipelineState(bundle, {});
    const commands = branchCommands(initial.state, initial.commands);
    const left = commands.left;
    const right = commands.right;
    if (left === undefined || right === undefined) {
      throw new TypeError('Expected both parallel branch dispatches.');
    }
    const selected = advancePipeline(bundle, initial.state, terminalEvent(left, kind));
    const owner = selected.state.frames.find((frame) => frame.kind === 'parallel');
    expect(selected).toMatchObject({ state: { status: 'running' }, commands: [] });
    expect(owner).toMatchObject({ kind: 'parallel', status: 'draining', selected: selection });
    const completed = advancePipeline(
      bundle,
      selected.state,
      terminalEvent(right, 'activitySucceeded'),
    );
    expect(completed).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [] },
      commands: [{ kind: 'complete' }],
    });
  });

  it.each([
    ['any', { kind: 'any' as const }],
    ['threshold', { kind: 'threshold' as const, count: 1 }],
  ])('cancels async siblings after a %s winner and waits for acknowledgement', (_name, policy) => {
    const bundle = parallelActivityProgram('cancel', policy);
    const initial = createInitialPipelineState(bundle, {});
    const commands = branchCommands(initial.state, initial.commands);
    const left = commands.left;
    const right = commands.right;
    if (left === undefined || right === undefined) {
      throw new TypeError('Expected both parallel branch dispatches.');
    }
    const selected = advancePipeline(
      bundle,
      initial.state,
      terminalEvent(left, 'activitySucceeded'),
    );
    expect(selected).toMatchObject({
      state: { status: 'running', regionCancellations: [{ awaiting: [right.key] }] },
      commands: [{ kind: 'cancelPending', targets: [right.key] }],
    });
    const completed = advancePipeline(
      bundle,
      selected.state,
      terminalEvent(right, 'activityCancelled'),
    );
    expect(completed).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [], regionCancellations: [] },
      commands: [{ kind: 'complete' }],
    });
  });

  it.each([
    ['any', { kind: 'any' as const }],
    ['threshold', { kind: 'threshold' as const, count: 1 }],
  ])('prunes queued synchronous siblings after a %s winner', (_name, policy) => {
    const initialized = createInitialPipelineState(synchronousParallelProgram(policy), {});
    expect(initialized).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [] },
      commands: [{ kind: 'complete' }],
    });
  });

  it('keeps isolated cancellation as failed while cancelling its live sibling', () => {
    const bundle = parallelActivityProgram('cancel');
    const initial = createInitialPipelineState(bundle, {});
    const commands = branchCommands(initial.state, initial.commands);
    const left = commands.left;
    const right = commands.right;
    if (left === undefined || right === undefined) {
      throw new TypeError('Expected both parallel branch dispatches.');
    }
    const selected = advancePipeline(
      bundle,
      initial.state,
      terminalEvent(left, 'activityCancelled'),
    );
    const owner = selected.state.frames.find((frame) => frame.kind === 'parallel');
    expect(selected).toMatchObject({
      state: {
        status: 'running',
        regionCancellations: [{ awaiting: [right.key] }],
      },
      commands: [{ kind: 'cancelPending', targets: [right.key] }],
    });
    expect(owner).toMatchObject({ kind: 'parallel', selected: 'failed', status: 'cancelling' });
    const completed = advancePipeline(
      bundle,
      selected.state,
      terminalEvent(right, 'activityCancelled'),
    );
    expect(completed).toMatchObject({
      state: { status: 'succeeded', result: { outcome: 'ok' } },
      commands: [{ kind: 'complete' }],
    });
  });

  it.each([
    ['missing input', { value: { kind: 'scopeInput', pointer: '/missing' } }],
    ['schema-mismatched input', { value: { kind: 'literal', value: 1 } }],
  ] as const)('rejects a Program with a statically %s', (_name, input) => {
    const bundle = parallelActivityProgram('cancel', { kind: 'all' }, input);
    const initial = createInitialPipelineState(bundle, {});
    expect(initial).toMatchObject({
      state: { status: 'failed', frames: [], pending: [], fault: { code: 'PROGRAM_INVALID' } },
      commands: [{ kind: 'fail', code: 'PROGRAM_INVALID' }],
    });
  });

  it('preserves hostile branch keys in region and result records without prototype mutation', () => {
    const keys = ['__proto__', 'right'] as const;
    const active = createInitialPipelineState(
      parallelActivityProgram('drain', { kind: 'all' }, {}, keys),
      {},
    );
    const owner = active.state.frames.find((frame) => frame.kind === 'parallel');
    if (owner?.kind !== 'parallel') {
      throw new TypeError('Expected a parallel owner.');
    }
    expect(Object.getPrototypeOf(owner.branchRegionKeys)).toBe(Object.prototype);
    expect(Object.hasOwn(owner.branchRegionKeys, '__proto__')).toBe(true);

    const commands = branchCommands(active.state, active.commands);
    const hostile = Reflect.getOwnPropertyDescriptor(commands, '__proto__')?.value;
    if (hostile === undefined) {
      throw new TypeError('Expected a hostile-key branch command.');
    }
    const failed = advancePipeline(
      parallelActivityProgram('drain', { kind: 'all' }, {}, keys),
      active.state,
      terminalEvent(hostile, 'activityFailed'),
    );
    const failedOwner = failed.state.frames.find((frame) => frame.kind === 'parallel');
    if (failedOwner?.kind !== 'parallel') {
      throw new TypeError('Expected a failed parallel owner.');
    }
    expect(Object.getPrototypeOf(failedOwner.branchResults)).toBe(Object.prototype);
    expect(Object.hasOwn(failedOwner.branchResults, '__proto__')).toBe(true);
    expect(failedOwner.branchResults.__proto__).toMatchObject({ status: 'failed' });
  });

  it.each(['generic', 'votes'] as const)(
    'preserves hostile %s records while cancelling an owning unstarted branch',
    (mode) => {
      const bundle = unstartedParallelProgram(mode);
      const initial = createInitialPipelineState(bundle, {});
      const commands = branchCommands(initial.state, initial.commands);
      const winner = commands.winner;
      const live = commands.live;
      const unstarted = Reflect.getOwnPropertyDescriptor(commands, '__proto__')?.value;
      if (winner === undefined || live === undefined || unstarted === undefined) {
        throw new TypeError('Expected winner, live, and unstarted branch commands.');
      }
      if (unstarted.ref.nodeId === '$pipeline') {
        throw new TypeError('Expected an activity node reference.');
      }
      const unstartedNodeId = unstarted.ref.nodeId;
      const reset = {
        ...initial.state,
        frames: initial.state.frames.map((frame) =>
          frame.key === unstarted.ref.frameKey && 'ready' in frame
            ? { ...frame, ready: [unstartedNodeId], nodeResults: {} }
            : frame,
        ),
        pending: initial.state.pending.filter(({ commandKey }) => commandKey !== unstarted.key),
      };

      const selected = advancePipeline(
        bundle,
        reset,
        terminalEvent(winner, 'activitySucceeded', mode === 'votes' ? 'approve' : {}),
      );
      const owner = selected.state.frames.find((frame) => frame.kind === 'parallel');
      if (owner?.kind !== 'parallel') {
        throw new TypeError('Expected a selected parallel owner.');
      }
      expect(selected).toMatchObject({
        state: { status: 'running', regionCancellations: [{ awaiting: [live.key] }] },
        commands: [{ kind: 'cancelPending', targets: [live.key] }],
      });
      expect(Object.getPrototypeOf(owner.branchRegionKeys)).toBe(Object.prototype);
      expect(Object.isFrozen(owner.branchRegionKeys)).toBe(true);
      expect(Object.keys(owner.branchRegionKeys)).toEqual(['live']);
      expect(Object.hasOwn(owner.branchRegionKeys, 'live')).toBe(true);
      expect(Object.hasOwn(owner.branchRegionKeys, '__proto__')).toBe(false);
      expect(Object.getPrototypeOf(owner.branchResults)).toBe(Object.prototype);
      expect(Object.isFrozen(owner.branchResults)).toBe(true);
      expect(Object.keys(owner.branchResults).toSorted()).toEqual(['__proto__', 'winner']);
      expect(Object.hasOwn(owner.branchResults, '__proto__')).toBe(true);
      expect(owner.branchResults.winner).toMatchObject(
        mode === 'generic'
          ? { status: 'completed', outcome: 'succeeded', output: {} }
          : { status: 'vote', vote: 'approve' },
      );
      expect(Reflect.getOwnPropertyDescriptor(owner.branchResults, '__proto__')).toMatchObject({
        value: { status: 'cancelled' },
      });
      expect(Object.hasOwn(owner.branchResults, 'live')).toBe(false);
      expect(Object.prototype).not.toHaveProperty('status');

      const completed = advancePipeline(
        bundle,
        selected.state,
        terminalEvent(live, 'activityCancelled'),
      );
      expect(completed).toMatchObject({
        state: { status: 'succeeded', frames: [], pending: [], regionCancellations: [] },
        commands: [{ kind: 'complete' }],
      });
    },
  );
});
