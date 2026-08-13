import type { Static } from 'typebox';
import { Compile } from 'typebox/compile';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createInitialPipelineState,
  FrameKeyPayloadSchema,
  InitialPipelineTransitionSchema,
  KernelProgramSchema,
  MachineFrameSchema,
  PipelineCommandSchema,
  type PipelineCommand,
  PipelineEventSchema,
  type PipelineEvent,
  PipelineStateSchema,
  PipelineTransitionSchema,
  type MachineFrame,
} from '../../src/kernel/index.js';
import {
  kernelDigest,
  kernelModule,
  kernelProgram,
  kernelRegion,
} from '../support/kernel-builders.js';
import {
  machineFrameExamples,
  pipelineCommandExamples,
  pipelineEventExamples,
} from '../support/kernel-contract-examples.js';
import { programEnd, programId } from '../support/program-builders.js';

const validators = {
  program: Compile(KernelProgramSchema),
  state: Compile(PipelineStateSchema),
  event: Compile(PipelineEventSchema),
  command: Compile(PipelineCommandSchema),
  initial: Compile(InitialPipelineTransitionSchema),
  transition: Compile(PipelineTransitionSchema),
  frame: Compile(MachineFrameSchema),
  frameKeyPayload: Compile(FrameKeyPayloadSchema),
};

const rootEndProgram = () => {
  const end = programEnd(programId('1'));
  return kernelProgram([kernelModule('main', kernelRegion([end]))]);
};

describe('kernel transition contract', () => {
  it('keeps runtime and static unions aligned', () => {
    expectTypeOf<Static<typeof MachineFrameSchema>>().toEqualTypeOf<MachineFrame>();
    expectTypeOf<Static<typeof PipelineEventSchema>>().toEqualTypeOf<PipelineEvent>();
    expectTypeOf<Static<typeof PipelineCommandSchema>>().toEqualTypeOf<PipelineCommand>();
  });

  it.each([
    ['frame', validators.frame, machineFrameExamples()],
    ['event', validators.event, pipelineEventExamples()],
    ['command', validators.command, pipelineCommandExamples()],
  ] as const)(
    'closes every %s variant and requires every declared field',
    (_name, validator, examples) => {
      for (const example of examples) {
        expect(validator.Check(example)).toBe(true);
        expect(validator.Check({ ...example, undeclared: true })).toBe(false);
        for (const field of Object.keys(example)) {
          const incomplete = { ...example } as Record<string, unknown>;
          delete incomplete[field];
          expect(validator.Check(incomplete)).toBe(false);
        }
      }
    },
  );

  it('keeps every Machine envelope closed and JSON portable', () => {
    const bundle = rootEndProgram();
    const result = createInitialPipelineState(bundle, {});
    expect(validators.program.Check(bundle)).toBe(true);
    expect(result.state.status).toBe('succeeded');
    expect(validators.state.Check(result.state)).toBe(true);
    expect(result.commands.every((command) => validators.command.Check(command))).toBe(true);
    expect(
      validators.initial.Check({
        kind: 'initialized',
        state: result.state,
        commands: result.commands,
      }),
    ).toBe(true);
    expect(
      validators.transition.Check({
        kind: 'advanced',
        state: result.state,
        commands: result.commands,
      }),
    ).toBe(true);
    expect(validators.state.Check(JSON.parse(JSON.stringify(result.state)))).toBe(true);
  });

  it('accepts ordinal zero and rejects a negative repeat-body ordinal', () => {
    const repeatBody = machineFrameExamples().find(({ kind }) => kind === 'repeatBody');
    expect(repeatBody).toMatchObject({ ordinal: 0 });
    expect(validators.frame.Check(repeatBody)).toBe(true);
    expect(validators.frame.Check({ ...repeatBody, ordinal: -1 })).toBe(false);

    const frameKeyPayload = {
      kind: 'repeatBody',
      parentFrameKey: kernelDigest('2'),
      regionId: kernelDigest('5'),
      ordinal: 0,
    };
    expect(validators.frameKeyPayload.Check(frameKeyPayload)).toBe(true);
    expect(validators.frameKeyPayload.Check({ ...frameKeyPayload, ordinal: -1 })).toBe(false);
  });

  it.each([
    ['program', () => validators.program.Check({ ...rootEndProgram(), host: true })],
    ['state', () => validators.state.Check({ schemaVersion: 'pipeline-state/v2' })],
    ['event', () => validators.event.Check({ kind: 'activityRetried' })],
    ['command', () => validators.command.Check({ kind: 'dispatchActivity', runtimeId: 'x' })],
    [
      'transition',
      () => validators.transition.Check({ kind: 'advanced', commands: [], extra: true }),
    ],
  ])('rejects an undeclared %s shape', (_name, check) => {
    expect(check()).toBe(false);
  });
});
