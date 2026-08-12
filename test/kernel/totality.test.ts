import { describe, expect, it } from 'vitest';

import type { ProgramActivityNode } from '../../src/program/index.js';
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

const activityFixture = () => {
  const end = programEnd(programId('9'));
  const activity: ProgramActivityNode = {
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
  return { bundle, initial, command: activityDispatch(initial) };
};

const activityEvent = (command: ReturnType<typeof activityDispatch>) => ({
  kind: 'activitySucceeded' as const,
  commandKey: command.key,
  ref: command.ref,
  output: {},
});

describe('kernel portable totality and argument ownership', () => {
  it.each([
    ['missing modules', { schemaVersion: 'pipeline-program/v1', entryModule: 'main' }],
    ['null module', { modules: [null], entryModule: 'main' }],
    ['null region', { modules: [{ key: 'main', region: null }], entryModule: 'main' }],
    [
      'malformed current node',
      {
        modules: [
          {
            key: 'main',
            region: { id: programId('f'), nodes: [{ id: programId('1'), secret: 'hidden' }] },
          },
        ],
        entryModule: 'main',
      },
    ],
  ] as const)(
    'fails a same-digest %s Program as an invariant without throwing',
    (_name, program) => {
      const { bundle, initial, command } = activityFixture();
      const malformed = structuredClone(bundle);
      Object.defineProperty(malformed, 'program', {
        enumerable: true,
        value: program,
        writable: true,
      });
      const rootFrame = initial.state.frames.find(({ kind }) => kind === 'rootRegion');

      const result = terminalResult(
        advanceBaseKernel(malformed, initial.state, activityEvent(command)),
      );

      expect(result.state.fault).toEqual({ code: 'INVARIANT_PROGRAM_STATE', path: '' });
      expect(result.commands).toHaveLength(1);
      expect(result.commands[0]?.ref).toEqual({
        programDigest: bundle.programDigest,
        frameKey: rootFrame?.key,
        nodeId: '$pipeline',
      });
      expect(JSON.stringify(result)).not.toContain('hidden');
    },
  );

  it('returns stable failures for hostile reflection without invoking accessors', () => {
    let accessed = false;
    const hostileBundle = Object.defineProperty({}, 'programDigest', {
      enumerable: true,
      get: () => {
        accessed = true;
        throw new Error('secret');
      },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    expect(() => initializeBaseKernel(hostileBundle, revoked.proxy)).not.toThrow();
    expect(accessed).toBe(false);

    const { bundle, initial } = activityFixture();
    const result = advanceBaseKernel(bundle, initial.state, revoked.proxy);
    expect(result.kind).toBe('rejected');
    expect(result.kind === 'rejected' && result.faults[0].code).toBe('EVENT_SCHEMA');
  });

  it('does not mutate Program, state, input, or event arguments', () => {
    const input = {};
    const { bundle, initial, command } = activityFixture();
    const event = activityEvent(command);
    const before = JSON.stringify({ bundle, state: initial.state, input, event });

    initializeBaseKernel(bundle, input);
    advanceBaseKernel(bundle, initial.state, event);

    expect(JSON.stringify({ bundle, state: initial.state, input, event })).toBe(before);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(event)).toBe(false);
  });
});
