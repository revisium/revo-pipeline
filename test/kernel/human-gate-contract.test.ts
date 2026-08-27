import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../src/index.js';
import { advancePipeline, createInitialPipelineState } from '../../src/kernel/public.js';
import { validatePipelineSource } from '../../src/source/index.js';
import { materializationFor } from '../support/compiler-builders.js';
import {
  emptySchema,
  endNode,
  sourceForNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../support/source-builders.js';

describe('human-gate payload and deadline', () => {
  it('canonicalizes payload schemas before deriving source and program identities', () => {
    const source = sourceForNode({
      ...sourceNodeBuilders.humanGate(),
      payloadSchema: { type: 'string', enum: ['z', 'a'] },
    });
    const equivalent = sourceForNode({
      ...sourceNodeBuilders.humanGate(),
      payloadSchema: { type: 'string', enum: ['a', 'z'] },
    });
    const validated = validatePipelineSource(source);
    const reordered = validatePipelineSource(equivalent);
    if (!validated.ok || !reordered.ok) {
      throw new TypeError('Expected valid human-gate payload schemas.');
    }
    const compiled = compilePipeline(source, materializationFor(source));
    const reorderedCompiled = compilePipeline(equivalent, materializationFor(equivalent));
    if (!compiled.ok || !reorderedCompiled.ok) {
      throw new TypeError('Expected payload-schema compilation to succeed.');
    }

    expect(reordered.value.sourceDigest).toBe(validated.value.sourceDigest);
    expect(reorderedCompiled.programDigest).toBe(compiled.programDigest);
  });

  it('reports invalid payload schema bounds at the payload schema path', () => {
    const source = sourceForNode({
      ...sourceNodeBuilders.humanGate(),
      payloadSchema: { type: 'integer', minimum: 2, maximum: 1 },
    });
    const result = validatePipelineSource(source);

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: 'BOUND_EXCEEDED',
          path: '/modules/0/region/nodes/0/payloadSchema',
        },
      ],
    });
  });

  it('emits the payload schema and deadline without a conflict route', () => {
    const source = sourceForNode({
      ...sourceNodeBuilders.humanGate(),
      payloadSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      deadline: { afterMs: 1, target: 'done' },
      routes: {
        answers: [{ answer: 'yes', target: 'done' }],
        cancelled: 'done',
      },
    });
    const compiled = compilePipeline(source, materializationFor(source));

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    const initial = createInitialPipelineState(
      { program: compiled.program, programDigest: compiled.programDigest },
      {},
    );

    expect(initial.commands).toContainEqual(
      expect.objectContaining({
        kind: 'openHumanGate',
        payloadSchema: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false,
        },
        deadline: { afterMs: 1 },
      }),
    );
  });

  it('compiles an answer payload projection after a gate with no deadline', () => {
    const gate = {
      ...sourceNodeBuilders.humanGate(),
      id: 'approval',
      payloadSchema: { type: 'string' as const },
      deadline: null,
      routes: {
        answers: [{ answer: 'yes', target: 'consume' }] as const,
        cancelled: 'done',
      },
    };
    const consumer = {
      ...sourceNodeBuilders.script(),
      id: 'consume',
      input: {
        payload: { kind: 'nodeOutput' as const, node: 'approval', pointer: '/payload' as const },
      },
      inputSchema: {
        type: 'object' as const,
        properties: { payload: { type: 'string' as const } },
        required: ['payload'] as const,
        additionalProperties: false as const,
      },
      outputSchema: emptySchema(),
      routes: { succeeded: 'done', failed: 'done', cancelled: 'done' },
    };
    const source = sourceWithNodes([gate, consumer, endNode()], 'approval');

    expect(compilePipeline(source, materializationFor(source))).toMatchObject({ ok: true });
  });

  it.each([
    [
      'a payload that violates the declared schema',
      {
        ...sourceNodeBuilders.humanGate(),
        payloadSchema: { type: 'string' as const },
      },
      {
        kind: 'gateResolved' as const,
        resolution: { kind: 'answer' as const, answer: 'yes', actorRef: 'reviewer', payload: 1 },
      },
    ],
    [
      'a non-null payload when the schema is null',
      sourceNodeBuilders.humanGate(),
      {
        kind: 'gateResolved' as const,
        resolution: {
          kind: 'answer' as const,
          answer: 'yes',
          actorRef: 'reviewer',
          payload: { unexpected: true },
        },
      },
    ],
  ])('rejects %s without consuming the pending gate', (_name, node, event) => {
    const source = sourceForNode(node);
    const compiled = compilePipeline(source, materializationFor(source));
    if (!compiled.ok) {
      throw new TypeError(
        `Expected compilation to succeed: ${JSON.stringify(compiled.diagnostics)}`,
      );
    }
    const initial = createInitialPipelineState(
      { program: compiled.program, programDigest: compiled.programDigest },
      {},
    );
    const command = initial.commands.find((candidate) => candidate.kind === 'openHumanGate');
    if (command === undefined) {
      throw new TypeError('Expected an open gate command.');
    }
    const rejected = advancePipeline(
      { program: compiled.program, programDigest: compiled.programDigest },
      initial.state,
      { ...event, commandKey: command.key, ref: command.ref },
    );

    expect(rejected).toMatchObject({
      kind: 'rejected',
      faults: [{ code: 'DATA_SCHEMA_MISMATCH', path: '/payload' }],
    });
    expect(rejected.state).toBe(initial.state);
  });

  it('rejects a deadline without a deadline contract without consuming the pending gate', () => {
    const source = sourceForNode(sourceNodeBuilders.humanGate());
    const compiled = compilePipeline(source, materializationFor(source));
    if (!compiled.ok) {
      throw new TypeError(
        `Expected compilation to succeed: ${JSON.stringify(compiled.diagnostics)}`,
      );
    }
    const initial = createInitialPipelineState(
      { program: compiled.program, programDigest: compiled.programDigest },
      {},
    );
    const command = initial.commands.find((candidate) => candidate.kind === 'openHumanGate');
    if (command === undefined) {
      throw new TypeError('Expected an open gate command.');
    }
    const rejected = advancePipeline(
      { program: compiled.program, programDigest: compiled.programDigest },
      initial.state,
      {
        kind: 'gateResolved',
        commandKey: command.key,
        ref: command.ref,
        resolution: { kind: 'deadline' },
      },
    );

    expect(rejected).toMatchObject({ kind: 'rejected', faults: [{ code: 'EVENT_GATE_ANSWER' }] });
    expect(rejected.state).toBe(initial.state);
  });

  it.each([
    [
      'answer',
      {
        kind: 'gateResolved' as const,
        resolution: {
          kind: 'answer' as const,
          answer: 'yes',
          actorRef: 'reviewer',
          payload: null,
        },
      },
      { kind: 'gateCancelled' as const },
    ],
    [
      'deadline',
      { kind: 'gateResolved' as const, resolution: { kind: 'deadline' as const } },
      {
        kind: 'gateResolved' as const,
        resolution: {
          kind: 'answer' as const,
          answer: 'yes',
          actorRef: 'reviewer',
          payload: null,
        },
      },
    ],
    [
      'cancelled',
      { kind: 'gateCancelled' as const },
      {
        kind: 'gateResolved' as const,
        resolution: {
          kind: 'answer' as const,
          answer: 'yes',
          actorRef: 'reviewer',
          payload: null,
        },
      },
    ],
  ] as const)(
    'retains one-shot %s replay while the continuation is live',
    (_name, event, other) => {
      const gate = {
        ...sourceNodeBuilders.humanGate(),
        id: 'approval',
        deadline: { afterMs: 1, target: 'continue' },
        routes: {
          answers: [{ answer: 'yes', target: 'continue' }] as const,
          cancelled: 'continue',
        },
      };
      const continuation = {
        ...sourceNodeBuilders.script(),
        id: 'continue',
        routes: { succeeded: 'done', failed: 'done', cancelled: 'done' },
      };
      const source = sourceWithNodes([gate, continuation, endNode()], 'approval');
      const compiled = compilePipeline(source, materializationFor(source));
      if (!compiled.ok) {
        throw new TypeError(`Expected compilation: ${JSON.stringify(compiled.diagnostics)}`);
      }
      const bundle = { program: compiled.program, programDigest: compiled.programDigest };
      const initial = createInitialPipelineState(bundle, {});
      const command = initial.commands.find((candidate) => candidate.kind === 'openHumanGate');
      if (command === undefined) {
        throw new TypeError('Expected an open gate command.');
      }
      const acceptedEvent = { ...event, commandKey: command.key, ref: command.ref };
      const accepted = advancePipeline(bundle, initial.state, acceptedEvent);
      expect(accepted).toMatchObject({
        kind: 'advanced',
        state: { status: 'running' },
        commands: [{ kind: 'dispatchActivity' }],
      });
      if (accepted.kind !== 'advanced') {
        return;
      }

      const replay = advancePipeline(bundle, accepted.state, acceptedEvent);
      expect(replay).toEqual({ kind: 'advanced', state: accepted.state, commands: [] });
      expect(replay.state).toBe(accepted.state);

      const conflict = advancePipeline(bundle, accepted.state, {
        ...other,
        commandKey: command.key,
        ref: command.ref,
      });
      expect(conflict).toMatchObject({ kind: 'rejected', faults: [{ code: 'EVENT_CONFLICT' }] });
      expect(conflict.state).toBe(accepted.state);
    },
  );
});
