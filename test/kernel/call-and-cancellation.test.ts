import { describe, expect, it } from 'vitest';

import { advancePipeline, createInitialPipelineState } from '../../src/kernel/index.js';
import type { ProgramNode } from '../../src/program/index.js';
import {
  kernelModule,
  kernelProgram,
  kernelRegion,
  runningResult,
  terminalResult,
} from '../support/kernel-builders.js';
import { literalAgentInputSchema, programEnd, programId } from '../support/program-builders.js';
import { emptySchema } from '../support/source-builders.js';

describe('kernel linked calls and run cancellation', () => {
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

    const result = terminalResult(createInitialPipelineState(bundle, {}));

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
      input: { prompt: { kind: 'literal', value: 'cancel' } },
      inputSchema: literalAgentInputSchema('cancel'),
      outputSchema: emptySchema(),
      routes: { succeeded: end.id, failed: end.id, cancelled: end.id },
    };
    const bundle = kernelProgram([kernelModule('main', kernelRegion([activity, end]))]);
    const initial = runningResult(createInitialPipelineState(bundle, {}));

    const requested = runningResult(
      advancePipeline(bundle, initial.state, {
        kind: 'cancelRequested',
        reasonCode: 'USER',
      }),
    );
    expect(requested.state.status).toBe('cancelling');
    expect(requested.commands.map(({ kind }) => kind)).toEqual(['cancelPending']);

    const duplicate = advancePipeline(bundle, requested.state, {
      kind: 'cancelRequested',
      reasonCode: 'OTHER',
    });
    expect(duplicate).toMatchObject({ kind: 'advanced', commands: [] });
    expect(runningResult(duplicate).state).toBe(requested.state);

    const pending = requested.state.pending[0];
    if (pending?.kind !== 'activity') {
      throw new TypeError('Expected one cancelling activity.');
    }
    const acknowledged = terminalResult(
      advancePipeline(bundle, requested.state, {
        kind: 'activityCancelled',
        commandKey: pending.commandKey,
        ref: pending.ref,
      }),
    );
    expect(acknowledged.state.status).toBe('cancelled');
    expect(acknowledged.commands.map(({ kind }) => kind)).toEqual(['cancel']);
  });
});
