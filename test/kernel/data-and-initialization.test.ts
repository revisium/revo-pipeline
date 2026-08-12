import { describe, expect, it } from 'vitest';

import type { ProgramNode } from '../../src/program/index.js';
import {
  activityDispatch,
  boundaryResult,
  kernelModule,
  kernelProgram,
  kernelRegion,
  terminalResult,
} from '../support/kernel-builders.js';
import {
  advanceBaseKernel,
  computeFrameKey,
  initializeBaseKernel,
} from '../support/kernel-internal.js';
import { programEnd, programId } from '../support/program-builders.js';
import { emptySchema } from '../support/source-builders.js';

describe('kernel initialization and data failures', () => {
  it('fails a malformed Program without exposing hostile input data', () => {
    const result = terminalResult(initializeBaseKernel({}, { secret: 'must-not-leak' }));

    expect(result.state.fault).toEqual({ code: 'PROGRAM_INVALID', path: '/program' });
    expect(result.state).toMatchObject({
      programDigest: 'sha256:b15ff8e8f9172a2ecc0ffe97cbc63ac3198f16a8e47baae28e1b09a5b9ca1086',
      input: null,
      frames: [],
    });
    expect(result.commands).toEqual([
      {
        kind: 'fail',
        key: 'sha256:84d4adb5d4cfb805d6570e892891a3fb575064369750766fb416bfdd4024ddf7',
        ref: {
          programDigest: 'sha256:b15ff8e8f9172a2ecc0ffe97cbc63ac3198f16a8e47baae28e1b09a5b9ca1086',
          frameKey: 'sha256:b15ff8e8f9172a2ecc0ffe97cbc63ac3198f16a8e47baae28e1b09a5b9ca1086',
          nodeId: '$pipeline',
        },
        code: 'PROGRAM_INVALID',
        path: '/program',
      },
    ]);
    expect(JSON.stringify(result.commands)).not.toContain('must-not-leak');
  });

  it('retains only an own lexical Program digest in the pre-root identity', () => {
    const programDigest = `sha256:${'c'.repeat(64)}` as const;
    const result = terminalResult(
      initializeBaseKernel({ programDigest, program: null }, { secret: 'must-not-leak' }),
    );
    const frameKey = computeFrameKey({
      kind: 'initialization',
      parentFrameKey: null,
      programDigest,
    });

    expect(result.state).toMatchObject({ programDigest, input: null, frames: [] });
    expect(result.commands[0]?.ref).toEqual({ programDigest, frameKey, nodeId: '$pipeline' });
  });

  it('returns one redacted INIT_INPUT_SCHEMA failure without throwing', () => {
    const end = programEnd(programId('1'));
    const inputSchema = {
      type: 'object' as const,
      properties: { required: { type: 'string' as const } },
      required: ['required'],
      additionalProperties: false as const,
    };
    const bundle = kernelProgram([
      kernelModule('main', kernelRegion([end], { inputSchema }), inputSchema),
    ]);
    const input = { secret: 'must-not-leak' };

    const result = terminalResult(initializeBaseKernel(bundle, input));

    expect(result.state.fault).toEqual({ code: 'INIT_INPUT_SCHEMA', path: '/input' });
    const rootFrameKey = computeFrameKey({
      kind: 'rootRegion',
      parentFrameKey: null,
      regionId: bundle.program.modules[0].region.id,
    });
    expect(result.state.input).toBeNull();
    expect(result.state.frames).toEqual([]);
    expect(result.commands[0]?.ref).toEqual({
      programDigest: bundle.programDigest,
      frameKey: rootFrameKey,
      nodeId: '$pipeline',
    });
    expect(result.commands).toHaveLength(1);
    expect(JSON.stringify(result.commands)).not.toContain('must-not-leak');
    expect(Object.isFrozen(input)).toBe(false);
  });

  it('routes a missing activity input pointer through its failed route', () => {
    const failed = { ...programEnd(programId('9')), outcome: 'failed' };
    const activity: ProgramNode = {
      kind: 'activity',
      id: programId('1'),
      activityKind: 'script',
      requirementKey: 'script',
      input: { value: { kind: 'scopeInput', pointer: '/missing' } },
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
      outputSchema: emptySchema(),
      routes: { succeeded: failed.id, failed: failed.id, cancelled: failed.id },
    };
    const bundle = kernelProgram([
      kernelModule('main', kernelRegion([activity, failed], { outcomes: ['failed'] })),
    ]);

    const result = terminalResult(initializeBaseKernel(bundle, {}));

    expect(result.state.result?.outcome).toBe('failed');
    expect(result.commands.map(({ kind }) => kind)).toEqual(['complete']);
  });

  it('retains an activity output schema mismatch as a DATA failure route', () => {
    const failed = { ...programEnd(programId('9')), outcome: 'failed' };
    const activity: ProgramNode = {
      kind: 'activity',
      id: programId('1'),
      activityKind: 'script',
      requirementKey: 'script',
      input: {},
      inputSchema: emptySchema(),
      outputSchema: emptySchema(),
      routes: { succeeded: failed.id, failed: failed.id, cancelled: failed.id },
    };
    const bundle = kernelProgram([
      kernelModule('main', kernelRegion([activity, failed], { outcomes: ['failed'] })),
    ]);
    const initial = boundaryResult(initializeBaseKernel(bundle, {}));
    const command = activityDispatch(initial);

    const result = terminalResult(
      advanceBaseKernel(bundle, initial.state, {
        kind: 'activitySucceeded',
        commandKey: command.key,
        ref: command.ref,
        output: { unexpected: true },
      }),
    );

    expect(result.state.result?.outcome).toBe('failed');
    expect(result.commands.map(({ kind }) => kind)).toEqual(['complete']);
  });
});
