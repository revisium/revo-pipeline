import { describe, expect, it } from 'vitest';

import {
  advancePipeline,
  createInitialPipelineState,
  type PipelineCommand,
} from '../../src/kernel/index.js';
import { kernelModule, kernelProgram, kernelRegion } from '../support/kernel-builders.js';
import { programEnd, programId } from '../support/program-builders.js';
import { emptySchema } from '../support/source-builders.js';

const dispatch = (
  commands: readonly PipelineCommand[],
): Extract<PipelineCommand, { readonly kind: 'dispatchActivity' }> => {
  const command = commands.find(({ kind }) => kind === 'dispatchActivity');
  if (command?.kind !== 'dispatchActivity') {
    throw new TypeError('Expected one activity dispatch.');
  }
  return command;
};

const activityProgram = () => {
  const end = programEnd(programId('9'));
  const activity = {
    kind: 'activity' as const,
    id: programId('1'),
    activityKind: 'script' as const,
    requirementKey: 'work',
    input: {},
    inputSchema: emptySchema(),
    outputSchema: emptySchema(),
    routes: { succeeded: end.id, failed: end.id, cancelled: end.id },
  };
  return kernelProgram([kernelModule('main', kernelRegion([activity, end]))]);
};

describe('kernel transition contract', () => {
  it('exposes the final private initialization and advancement API', () => {
    const bundle = activityProgram();
    const initial = createInitialPipelineState(bundle, {});
    const command = dispatch(initial.commands);
    expect(initial).toMatchObject({ kind: 'initialized', state: { status: 'running' } });

    const advanced = advancePipeline(bundle, initial.state, {
      kind: 'activitySucceeded',
      commandKey: command.key,
      ref: command.ref,
      output: {},
    });
    expect(advanced).toMatchObject({
      kind: 'advanced',
      state: { status: 'succeeded', result: { outcome: 'ok', output: {} } },
      commands: [{ kind: 'complete' }],
    });
  });

  it('returns the identical immutable state for replay and terminal advancement', () => {
    const bundle = activityProgram();
    const initial = createInitialPipelineState(bundle, {});
    const command = dispatch(initial.commands);
    const event = {
      kind: 'activitySucceeded' as const,
      commandKey: command.key,
      ref: command.ref,
      output: {},
    };
    const terminal = advancePipeline(bundle, initial.state, event);
    const replay = advancePipeline(bundle, terminal.state, event);
    expect(replay).toEqual({ kind: 'advanced', state: terminal.state, commands: [] });
    expect(replay.state).toBe(terminal.state);
  });

  it('rejects a digest mismatch without interpreting the state', () => {
    const bundle = activityProgram();
    const initial = createInitialPipelineState(bundle, {});
    const foreign = { ...bundle, programDigest: `sha256:${'f'.repeat(64)}` as const };
    const rejected = advancePipeline(foreign, initial.state, {
      kind: 'cancelRequested',
      reasonCode: 'x',
    });
    expect(rejected).toMatchObject({
      kind: 'rejected',
      faults: [{ code: 'PROGRAM_DIGEST_MISMATCH' }],
    });
    expect(rejected.state).toBe(initial.state);
  });
});
