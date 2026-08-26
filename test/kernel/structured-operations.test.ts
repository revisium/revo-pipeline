import { describe, expect, it } from 'vitest';

import { advancePipeline, createInitialPipelineState } from '../../src/kernel/index.js';
import { kernelModule, kernelProgram, kernelRegion } from '../support/kernel-builders.js';
import { programEnd, programNodeExamples } from '../support/program-builders.js';
import { emptySchema, sourceNodeBuilders } from '../support/source-builders.js';
import { commandOf, compileStructuredNode } from '../support/structured-machine.js';

describe('kernel structured operations', () => {
  it.each([
    ['missing', { kind: 'scopeInput', pointer: '/missing' }],
    ['schema-mismatched', { kind: 'literal', value: 1 }],
  ] as const)('rejects a statically %s activity input', (_name, selector) => {
    const activity = programNodeExamples().find((node) => node.kind === 'activity');
    if (activity?.kind !== 'activity') {
      throw new TypeError('Expected an activity example.');
    }
    const end = programEnd();
    const node = {
      ...activity,
      input: { value: selector },
      inputSchema: {
        type: 'object' as const,
        properties: { value: { type: 'string' as const } },
        required: ['value'],
        additionalProperties: false as const,
      },
      outputSchema: emptySchema(),
      routes: { succeeded: end.id, failed: end.id, cancelled: end.id },
    };
    const bundle = kernelProgram([
      kernelModule('main', kernelRegion([node, end], { entry: node.id })),
    ]);
    expect(createInitialPipelineState(bundle, {})).toMatchObject({
      state: { status: 'failed', fault: { code: 'PROGRAM_INVALID' } },
      commands: [{ kind: 'fail', code: 'PROGRAM_INVALID' }],
    });
  });

  it.each(['waitCompleted', 'waitCancelled'] as const)(
    'routes %s through its declared continuation',
    (kind) => {
      const bundle = compileStructuredNode(sourceNodeBuilders.wait());
      const initial = createInitialPipelineState(bundle, {});
      const command = commandOf(initial.commands, 'scheduleWait');
      const advanced = advancePipeline(bundle, initial.state, {
        kind,
        commandKey: command.key,
        ref: command.ref,
      });
      expect(advanced).toMatchObject({
        kind: 'advanced',
        state: { status: 'succeeded' },
      });
    },
  );

  it.each([
    [
      'duration wait with signal',
      sourceNodeBuilders.wait(),
      { kind: 'signalReceived' as const, signal: 'unexpected', payload: null },
    ],
    [
      'signal wait with duration completion',
      {
        ...sourceNodeBuilders.wait(),
        wait: { kind: 'signal' as const, signal: 'ready', payloadSchema: null },
      },
      { kind: 'waitCompleted' as const },
    ],
  ])('rejects %s by operation subtype before signal validation', (_name, node, event) => {
    const bundle = compileStructuredNode(node);
    const initial = createInitialPipelineState(bundle, {});
    const command = commandOf(initial.commands, 'scheduleWait');
    const rejected = advancePipeline(bundle, initial.state, {
      ...event,
      commandKey: command.key,
      ref: command.ref,
    });
    expect(rejected).toMatchObject({
      kind: 'rejected',
      faults: [{ code: 'EVENT_OPERATION_KIND' }],
    });
    expect(rejected.state).toBe(initial.state);
  });

  it('routes a declared human answer with its audit attribution', () => {
    const bundle = compileStructuredNode(sourceNodeBuilders.humanGate());
    const initial = createInitialPipelineState(bundle, {});
    const command = commandOf(initial.commands, 'openHumanGate');
    const advanced = advancePipeline(bundle, initial.state, {
      kind: 'gateResolved',
      commandKey: command.key,
      ref: command.ref,
      resolution: { kind: 'answer', answer: 'yes', actorRef: 'reviewer', payload: null },
    });
    expect(advanced).toMatchObject({ kind: 'advanced', state: { status: 'succeeded' } });
  });

  it.each([
    ['deadline', { kind: 'gateResolved', resolution: { kind: 'deadline' } }],
    ['cancelled', { kind: 'gateCancelled' }],
  ] as const)('routes a %s gate terminal through its declared continuation', (_name, event) => {
    const bundle = compileStructuredNode({
      ...sourceNodeBuilders.humanGate(),
      deadline: { afterMs: 1, target: 'done' },
    });
    const initial = createInitialPipelineState(bundle, {});
    const command = commandOf(initial.commands, 'openHumanGate');
    const advanced = advancePipeline(bundle, initial.state, {
      ...event,
      commandKey: command.key,
      ref: command.ref,
    });
    expect(advanced).toMatchObject({ state: { status: 'succeeded' } });
  });

  it('rejects undeclared signals and fails invalid declared payload data', () => {
    const wait = {
      ...sourceNodeBuilders.wait(),
      wait: {
        kind: 'signal' as const,
        signal: 'ready',
        payloadSchema: { type: 'string' as const },
      },
    };
    const bundle = compileStructuredNode(wait);
    const initial = createInitialPipelineState(bundle, {});
    const command = commandOf(initial.commands, 'scheduleWait');
    const foreign = advancePipeline(bundle, initial.state, {
      kind: 'signalReceived',
      commandKey: command.key,
      ref: command.ref,
      signal: 'other',
      payload: 'ok',
    });
    expect(foreign).toMatchObject({ kind: 'rejected', faults: [{ code: 'EVENT_SIGNAL' }] });
    expect(foreign.state).toBe(initial.state);

    const invalid = advancePipeline(bundle, initial.state, {
      kind: 'signalReceived',
      commandKey: command.key,
      ref: command.ref,
      signal: 'ready',
      payload: 1,
    });
    expect(invalid).toMatchObject({
      kind: 'advanced',
      state: { status: 'failed', fault: { code: 'DATA_SCHEMA_MISMATCH', path: '/payload' } },
      commands: [{ kind: 'fail', code: 'DATA_SCHEMA_MISMATCH', path: '/payload' }],
    });
  });

  it.each([
    ['declared payload', { type: 'string' as const }, 'payload'],
    ['explicitly empty payload', null, null],
  ] as const)('accepts a %s signal', (_name, payloadSchema, payload) => {
    const bundle = compileStructuredNode({
      ...sourceNodeBuilders.wait(),
      wait: { kind: 'signal', signal: 'ready', payloadSchema },
    });
    const initial = createInitialPipelineState(bundle, {});
    const command = commandOf(initial.commands, 'scheduleWait');
    const advanced = advancePipeline(bundle, initial.state, {
      kind: 'signalReceived',
      commandKey: command.key,
      ref: command.ref,
      signal: 'ready',
      payload,
    });
    expect(advanced).toMatchObject({ state: { status: 'succeeded' } });
  });

  it('fails a non-null payload when the signal declares no payload schema', () => {
    const bundle = compileStructuredNode({
      ...sourceNodeBuilders.wait(),
      wait: { kind: 'signal', signal: 'ready', payloadSchema: null },
    });
    const initial = createInitialPipelineState(bundle, {});
    const command = commandOf(initial.commands, 'scheduleWait');
    const advanced = advancePipeline(bundle, initial.state, {
      kind: 'signalReceived',
      commandKey: command.key,
      ref: command.ref,
      signal: 'ready',
      payload: { unexpected: true },
    });
    expect(advanced).toMatchObject({
      state: { status: 'failed', fault: { code: 'DATA_SCHEMA_MISMATCH', path: '/payload' } },
      commands: [{ kind: 'fail', code: 'DATA_SCHEMA_MISMATCH', path: '/payload' }],
    });
  });

  it('routes an activity output schema mismatch through failed', () => {
    const bundle = compileStructuredNode(sourceNodeBuilders.script());
    const initial = createInitialPipelineState(bundle, {});
    const command = commandOf(initial.commands, 'dispatchActivity');
    const advanced = advancePipeline(bundle, initial.state, {
      kind: 'activitySucceeded',
      commandKey: command.key,
      ref: command.ref,
      output: { unexpected: true },
    });
    expect(advanced).toMatchObject({ state: { status: 'succeeded' } });
  });

  it('rejects an undeclared gate answer without consuming the operation', () => {
    const bundle = compileStructuredNode(sourceNodeBuilders.humanGate());
    const initial = createInitialPipelineState(bundle, {});
    const command = commandOf(initial.commands, 'openHumanGate');
    const rejected = advancePipeline(bundle, initial.state, {
      kind: 'gateResolved',
      commandKey: command.key,
      ref: command.ref,
      resolution: { kind: 'answer', answer: 'no', actorRef: 'reviewer', payload: null },
    });
    expect(rejected).toMatchObject({ kind: 'rejected', faults: [{ code: 'EVENT_GATE_ANSWER' }] });
    expect(rejected.state).toBe(initial.state);
  });
});
