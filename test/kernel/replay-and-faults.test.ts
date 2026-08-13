import { describe, expect, it } from 'vitest';

import { advancePipeline, createInitialPipelineState } from '../../src/kernel/index.js';
import {
  activityDispatch,
  kernelDigest,
  kernelModule,
  kernelProgram,
  kernelRegion,
  rejectedResult,
  runningResult,
  terminalResult,
} from '../support/kernel-builders.js';
import { computeEventDigest } from '../support/kernel-internal.js';
import { programEnd, programId } from '../support/program-builders.js';
import { emptySchema } from '../support/source-builders.js';

const fixture = () => {
  const end = programEnd(programId('9'));
  const secondActivity = {
    kind: 'activity' as const,
    id: programId('2'),
    activityKind: 'effect' as const,
    requirementKey: 'effect-2',
    input: {},
    inputSchema: emptySchema(),
    outputSchema: emptySchema(),
    routes: { succeeded: end.id, failed: end.id, cancelled: end.id },
  };
  const firstActivity = {
    kind: 'activity' as const,
    id: programId('1'),
    activityKind: 'effect' as const,
    requirementKey: 'effect-1',
    input: {},
    inputSchema: emptySchema(),
    outputSchema: emptySchema(),
    routes: {
      succeeded: secondActivity.id,
      failed: secondActivity.id,
      cancelled: secondActivity.id,
    },
  };
  const bundle = kernelProgram([
    kernelModule('main', kernelRegion([firstActivity, secondActivity, end])),
  ]);
  const initial = runningResult(createInitialPipelineState(bundle, {}));
  return { bundle, initial, command: activityDispatch(initial), firstActivity };
};

describe('kernel replay and fault precedence', () => {
  it('checks the program digest before event normalization', () => {
    const { bundle, initial } = fixture();
    const result = rejectedResult(
      advancePipeline(
        { ...bundle, programDigest: kernelDigest('f') },
        initial.state,
        new Proxy(
          {},
          {
            ownKeys: () => {
              throw new Error('secret');
            },
          },
        ),
      ),
    );
    expect(result.state).toBe(initial.state);
    expect(result.faults.map(({ code }) => code)).toEqual(['PROGRAM_DIGEST_MISMATCH']);
  });

  it.each([
    [{ kind: 'activityRetried' }, 'EVENT_EXECUTOR_OUTCOME'],
    [{ status: 'succeeded' }, 'EVENT_EXECUTOR_OUTCOME'],
    [{ outcome: 'succeeded' }, 'EVENT_EXECUTOR_OUTCOME'],
    [{ kind: 'unknown' }, 'EVENT_SCHEMA'],
    [null, 'EVENT_SCHEMA'],
  ] as const)('classifies malformed executor input without leaking values', (event, code) => {
    const { bundle, initial } = fixture();
    const result = rejectedResult(advancePipeline(bundle, initial.state, event));
    expect(result.state).toBe(initial.state);
    expect(result.faults[0].code).toBe(code);
    expect(JSON.stringify(result.faults)).not.toContain('secret');
  });

  it('rejects a foreign ref without mutating state', () => {
    const { bundle, initial, command } = fixture();
    const result = rejectedResult(
      advancePipeline(bundle, initial.state, {
        kind: 'activityCancelled',
        commandKey: command.key,
        ref: { ...command.ref, frameKey: kernelDigest('e') },
      }),
    );
    expect(result.state).toBe(initial.state);
    expect(result.faults[0].code).toBe('EVENT_FOREIGN');
  });

  it('rejects a valid event whose kind does not match the pending operation', () => {
    const { bundle, initial, command } = fixture();
    const result = rejectedResult(
      advancePipeline(bundle, initial.state, {
        kind: 'waitCompleted',
        commandKey: command.key,
        ref: command.ref,
      }),
    );

    expect(result.state).toBe(initial.state);
    expect(result.faults[0].code).toBe('EVENT_OPERATION_KIND');
  });

  it('retains live receipts for replay and prunes them after the frame completes', () => {
    const { bundle, initial, command, firstActivity } = fixture();
    const event = {
      kind: 'activitySucceeded' as const,
      commandKey: command.key,
      ref: command.ref,
      output: {},
    };
    const accepted = runningResult(advancePipeline(bundle, initial.state, event));
    const secondCommand = activityDispatch(accepted);
    expect(accepted.state.resolved).toEqual([
      {
        commandKey: command.key,
        ref: command.ref,
        eventDigest: computeEventDigest(event),
      },
    ]);
    expect(accepted.state.frames).toHaveLength(1);
    expect(accepted.state.frames[0]?.nodeResults).toEqual({
      [firstActivity.id]: { status: 'succeeded', output: {} },
    });

    const identical = runningResult(advancePipeline(bundle, accepted.state, event));
    expect(identical.state).toBe(accepted.state);
    expect(identical.commands).toEqual([]);

    const conflict = rejectedResult(
      advancePipeline(bundle, accepted.state, {
        kind: 'activityFailed',
        commandKey: command.key,
        ref: command.ref,
        errorCode: 'DIFFERENT',
      }),
    );
    expect(conflict.state).toBe(accepted.state);
    expect(conflict.faults[0].code).toBe('EVENT_CONFLICT');

    const completed = terminalResult(
      advancePipeline(bundle, accepted.state, {
        kind: 'activitySucceeded',
        commandKey: secondCommand.key,
        ref: secondCommand.ref,
        output: {},
      }),
    );
    expect(completed.state).toMatchObject({ status: 'succeeded', frames: [], resolved: [] });
  });
});
