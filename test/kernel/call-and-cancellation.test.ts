import { describe, expect, it } from 'vitest';

import type { ProgramNode } from '../../src/program/index.js';
import {
  boundaryResult,
  kernelModule,
  kernelProgram,
  kernelRegion,
  terminalResult,
} from '../support/kernel-builders.js';
import { advanceBaseKernel, initializeBaseKernel } from '../support/kernel-internal.js';
import { programEnd, programId } from '../support/program-builders.js';
import { emptySchema } from '../support/source-builders.js';

describe('kernel linked calls and base cancellation', () => {
  it('cancels immediately when a run has no pending operation', () => {
    const wait: ProgramNode = {
      kind: 'wait',
      id: programId('1'),
      wait: { kind: 'duration', durationMs: 1 },
      routes: { completed: programId('9'), cancelled: programId('9') },
    };
    const bundle = kernelProgram([
      kernelModule('main', kernelRegion([wait, programEnd(programId('9'))])),
    ]);
    const initial = initializeBaseKernel(bundle, {});
    if (initial.kind !== 'deferred-node') {
      throw new TypeError('Expected the deferred wait fixture.');
    }

    const result = terminalResult(
      advanceBaseKernel(bundle, initial.state, { kind: 'cancelRequested', reasonCode: 'USER' }),
    );

    expect(result.state.status).toBe('cancelled');
    expect(result.commands.map(({ kind }) => kind)).toEqual(['cancel']);
  });

  it('copies a called result into the parent before pruning', () => {
    const childEnd = programEnd(programId('5'));
    const parentEnd = programEnd(programId('9'));
    const call: ProgramNode = {
      kind: 'call',
      id: programId('1'),
      module: 'child',
      input: {},
      outputSchema: emptySchema(),
      routes: {
        outcomes: [{ outcome: 'ok', target: parentEnd.id }],
        failed: parentEnd.id,
        cancelled: parentEnd.id,
      },
    };
    const bundle = kernelProgram(
      [
        kernelModule('child', kernelRegion([childEnd], { id: programId('e') })),
        kernelModule('main', kernelRegion([call, parentEnd], { id: programId('f') })),
      ],
      'main',
    );

    const result = terminalResult(initializeBaseKernel(bundle, {}));

    expect(result.state.status).toBe('succeeded');
    expect(result.state.frames).toEqual([]);
    expect(result.state.result).toEqual({ outcome: 'ok', output: {} });
  });

  it('emits one run cancellation intent and stays nonterminal until acknowledgement', () => {
    const end = programEnd(programId('9'));
    const activity: ProgramNode = {
      kind: 'activity',
      id: programId('1'),
      activityKind: 'agent',
      requirementKey: 'agent',
      input: {},
      inputSchema: emptySchema(),
      outputSchema: emptySchema(),
      routes: { succeeded: end.id, failed: end.id, cancelled: end.id },
    };
    const bundle = kernelProgram([kernelModule('main', kernelRegion([activity, end]))]);
    const initial = boundaryResult(initializeBaseKernel(bundle, {}));

    const requested = boundaryResult(
      advanceBaseKernel(bundle, initial.state, {
        kind: 'cancelRequested',
        reasonCode: 'USER',
      }),
    );
    expect(requested.state.status).toBe('cancelling');
    expect(requested.commands.map(({ kind }) => kind)).toEqual(['cancelPending']);

    const duplicate = advanceBaseKernel(bundle, requested.state, {
      kind: 'cancelRequested',
      reasonCode: 'OTHER',
    });
    expect(duplicate).toMatchObject({ kind: 'boundary', commands: [] });
    expect(boundaryResult(duplicate).state).toBe(requested.state);

    const pending = requested.state.pending[0];
    if (pending?.kind !== 'activity') {
      throw new TypeError('Expected one cancelling activity.');
    }
    const acknowledged = terminalResult(
      advanceBaseKernel(bundle, requested.state, {
        kind: 'activityCancelled',
        commandKey: pending.commandKey,
        ref: pending.ref,
      }),
    );
    expect(acknowledged.state.status).toBe('cancelled');
    expect(acknowledged.commands.map(({ kind }) => kind)).toEqual(['cancel']);
  });
});
