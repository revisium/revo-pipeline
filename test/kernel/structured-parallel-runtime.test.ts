import { describe, expect, it } from 'vitest';

import {
  advancePipeline,
  createInitialPipelineState,
  type PipelineCommand,
  type PipelineState,
} from '../../src/kernel/index.js';
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
) => ({
  kind,
  commandKey: command.key,
  ref: command.ref,
  ...(kind === 'activityFailed' ? { errorCode: 'BRANCH_FAILED' } : {}),
  ...(kind === 'activitySucceeded' ? { output: {} } : {}),
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
  ] as const)('totalizes unstarted siblings after a %s preflight failure', (_name, input) => {
    const bundle = parallelActivityProgram('cancel', { kind: 'all' }, input);
    const initial = createInitialPipelineState(bundle, {});
    expect(initial).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [] },
      commands: [{ kind: 'complete' }],
    });
  });
});
