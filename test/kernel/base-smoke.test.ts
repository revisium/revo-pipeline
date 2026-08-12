import { describe, expect, it } from 'vitest';

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

describe('kernel base smoke', () => {
  it('saturates a root end into one terminal command', () => {
    const end = programEnd(programId('1'));
    const bundle = kernelProgram([kernelModule('main', kernelRegion([end]))]);

    const result = terminalResult(initializeBaseKernel(bundle, {}));

    expect(result.state.status).toBe('succeeded');
    expect(result.commands.map(({ kind }) => kind)).toEqual(['complete']);
  });

  it('dispatches and accepts one activity event', () => {
    const end = programEnd(programId('9'));
    const activity = {
      kind: 'activity' as const,
      id: programId('1'),
      activityKind: 'agent' as const,
      requirementKey: 'agent',
      input: {},
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
        additionalProperties: false as const,
      },
      outputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
        additionalProperties: false as const,
      },
      routes: { succeeded: end.id, failed: end.id, cancelled: end.id },
    };
    const bundle = kernelProgram([kernelModule('main', kernelRegion([activity, end]))]);
    const initial = boundaryResult(initializeBaseKernel(bundle, {}));
    const command = activityDispatch(initial);

    const result = terminalResult(
      advanceBaseKernel(bundle, initial.state, {
        kind: 'activitySucceeded',
        commandKey: command.key,
        ref: command.ref,
        output: {},
      }),
    );

    expect(result.state.status).toBe('succeeded');
    expect(result.commands.map(({ kind }) => kind)).toEqual(['complete']);
  });
});
