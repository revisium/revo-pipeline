import { describe, expect, it } from 'vitest';

import type { ProgramActivityNode, ProgramNode } from '../../src/program/index.js';
import {
  activityDispatch,
  boundaryResult,
  kernelModule,
  kernelProgram,
  kernelRegion,
  terminalResult,
} from '../support/kernel-builders.js';
import { advanceBaseKernel, initializeBaseKernel } from '../support/kernel-internal.js';
import { programEnd, programId } from '../support/program-builders.js';
import { emptySchema } from '../support/source-builders.js';

const activityProgram = () => {
  const succeeded = { ...programEnd(programId('9')), outcome: 'ok' };
  const failed = { ...programEnd(programId('8')), outcome: 'failed' };
  const cancelled = { ...programEnd(programId('7')), outcome: 'cancelled' };
  const activity: ProgramActivityNode = {
    kind: 'activity',
    id: programId('1'),
    activityKind: 'agent',
    requirementKey: 'agent',
    input: {},
    inputSchema: emptySchema(),
    outputSchema: emptySchema(),
    routes: { succeeded: succeeded.id, failed: failed.id, cancelled: cancelled.id },
  };
  return kernelProgram([
    kernelModule(
      'main',
      kernelRegion([activity, succeeded, failed, cancelled], {
        outcomes: ['cancelled', 'failed', 'ok'],
      }),
    ),
  ]);
};

const dispatch = (bundle = activityProgram()) => {
  const initial = boundaryResult(initializeBaseKernel(bundle, {}));
  return { bundle, initial, command: activityDispatch(initial) };
};

describe('kernel base advancement', () => {
  it.each([
    ['activitySucceeded', { output: {} }, 'ok'],
    ['activityFailed', { errorCode: 'PERMANENT' }, 'failed'],
    ['activityCancelled', {}, 'cancelled'],
  ] as const)('routes %s through the declared terminal path', (kind, fields, outcome) => {
    const prepared = dispatch();
    const { bundle, initial, command } = prepared;
    const result = terminalResult(
      advanceBaseKernel(bundle, initial.state, {
        kind,
        commandKey: command.key,
        ref: command.ref,
        ...fields,
      }),
    );
    expect(result.state.result?.outcome).toBe(outcome);
  });

  it('selects a choice from an exact completed node output', () => {
    const yes = programEnd(programId('9'));
    const no = { ...programEnd(programId('8')), outcome: 'no' };
    const choice: ProgramNode = {
      kind: 'choice',
      id: programId('2'),
      selector: { kind: 'nodeOutput', nodeId: programId('1'), pointer: '/answer' },
      cases: [{ key: 'yes', when: { kind: 'equals', value: true }, target: yes.id }],
      otherwise: no.id,
    };
    const activity: ProgramActivityNode = {
      kind: 'activity',
      id: programId('1'),
      activityKind: 'script',
      requirementKey: 'script',
      input: {},
      inputSchema: emptySchema(),
      outputSchema: {
        type: 'object',
        properties: { answer: { type: 'boolean' } },
        required: ['answer'],
        additionalProperties: false,
      },
      routes: { succeeded: choice.id, failed: no.id, cancelled: no.id },
    };
    const bundle = kernelProgram([
      kernelModule('main', kernelRegion([activity, choice, yes, no], { outcomes: ['no', 'ok'] })),
    ]);
    const { initial, command } = dispatch(bundle);
    const result = advanceBaseKernel(bundle, initial.state, {
      kind: 'activitySucceeded',
      commandKey: command.key,
      ref: command.ref,
      output: { answer: true },
    });
    expect(result.kind === 'terminal' && result.state.result?.outcome).toBe('ok');
  });

  it('does not materialize RP05 behavior at a deferred node', () => {
    const wait: ProgramNode = {
      kind: 'wait',
      id: programId('1'),
      wait: { kind: 'duration', durationMs: 1 },
      routes: { completed: programId('9'), cancelled: programId('9') },
    };
    const bundle = kernelProgram([
      kernelModule('main', kernelRegion([wait, programEnd(programId('9'))])),
    ]);
    const result = initializeBaseKernel(bundle, {});
    expect(result).toMatchObject({ kind: 'deferred-node', nodeId: wait.id });
    expect('commands' in result).toBe(false);
    expect('faults' in result).toBe(false);
  });
});
