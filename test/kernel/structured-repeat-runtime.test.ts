import { describe, expect, it } from 'vitest';

import {
  advancePipeline,
  createInitialPipelineState,
  type PipelineCommand,
} from '../../src/kernel/index.js';
import type { ProgramRepeatCondition } from '../../src/program/index.js';
import { repeatActivityProgram } from '../support/structured-kernel-builders.js';

type ActivityCommand = Extract<PipelineCommand, { readonly kind: 'dispatchActivity' }>;

const activityCommand = (commands: readonly PipelineCommand[]): ActivityCommand => {
  const command = commands.find(
    (candidate): candidate is ActivityCommand => candidate.kind === 'dispatchActivity',
  );
  if (command === undefined) {
    throw new TypeError('Expected a repeat body dispatch.');
  }
  return command;
};

const iterationEquals = (value: number): ProgramRepeatCondition => ({
  kind: 'equals',
  selector: { kind: 'repeat', value: 'iteration', pointer: '' },
  value,
});

const eventFor = (
  command: ActivityCommand,
  kind: 'activitySucceeded' | 'activityFailed' | 'activityCancelled',
) => ({
  kind,
  commandKey: command.key,
  ref: command.ref,
  ...(kind === 'activitySucceeded' ? { output: {} } : {}),
  ...(kind === 'activityFailed' ? { errorCode: 'BODY_FAILED' } : {}),
});

describe('structured repeat runtime outcomes', () => {
  it.each([
    ['activitySucceeded', iterationEquals(1), 'completed'],
    ['activityFailed', iterationEquals(1), 'failed'],
    ['activityCancelled', iterationEquals(1), 'cancelled'],
  ] as const)('routes a %s body to its declared terminal', (kind, condition, outcome) => {
    const bundle = repeatActivityProgram({ condition });
    const initial = createInitialPipelineState(bundle, {});
    const completed = advancePipeline(
      bundle,
      initial.state,
      eventFor(activityCommand(initial.commands), kind),
    );
    expect(completed).toMatchObject({
      state: { status: 'succeeded', result: { outcome } },
      commands: [{ kind: 'complete' }],
    });
  });

  it('refills the next iteration and selects exhausted at the exact maximum', () => {
    const bundle = repeatActivityProgram({
      condition: {
        kind: 'exists',
        selector: { kind: 'repeat', value: 'iteration', pointer: '' },
      },
    });
    const initial = createInitialPipelineState(bundle, {});
    const refilled = advancePipeline(
      bundle,
      initial.state,
      eventFor(activityCommand(initial.commands), 'activitySucceeded'),
    );
    expect(refilled).toMatchObject({
      state: { status: 'running' },
      commands: [{ kind: 'dispatchActivity' }],
    });
    const exhausted = advancePipeline(
      bundle,
      refilled.state,
      eventFor(activityCommand(refilled.commands), 'activitySucceeded'),
    );
    expect(exhausted).toMatchObject({
      state: { status: 'succeeded', result: { outcome: 'exhausted' } },
      commands: [{ kind: 'complete' }],
    });
  });

  it.each([
    [
      'next input pointer',
      {
        condition: iterationEquals(0),
        nextInput: { value: { kind: 'regionOutput', pointer: '/missing' } },
      },
    ],
    [
      'final output pointer',
      {
        condition: iterationEquals(1),
        output: { value: { kind: 'regionOutput', pointer: '/missing' } },
      },
    ],
  ] as const)('rejects a Program with an invalid %s', (_name, options) => {
    const bundle = repeatActivityProgram(options);
    const initial = createInitialPipelineState(bundle, {});
    expect(initial).toMatchObject({
      state: { status: 'failed', fault: { code: 'PROGRAM_INVALID' } },
      commands: [{ kind: 'fail', code: 'PROGRAM_INVALID' }],
    });
  });
});
