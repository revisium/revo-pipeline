import type { Static } from 'typebox';
import { Compile } from 'typebox/compile';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { ProgramNodeSchema, type ProgramNode } from '../../../src/program/index.js';
import { programId, programNodeExamples, programRegion } from '../../support/program-builders.js';

const validate = Compile(ProgramNodeSchema);

describe('closed Program node union', () => {
  it('keeps the runtime union aligned with the exact static node contract', () => {
    expectTypeOf<Static<typeof ProgramNodeSchema>>().toEqualTypeOf<ProgramNode>();
  });

  it.each(programNodeExamples().map((node) => [node.kind, node] as const))(
    'accepts the exact %s runtime/static contract and rejects extras',
    (_kind, node) => {
      expect(validate.Check(node)).toBe(true);
      expect(validate.Check({ ...node, undeclared: true })).toBe(false);
      for (const field of Object.keys(node)) {
        const incomplete = { ...node } as Record<string, unknown>;
        delete incomplete[field];
        expect(validate.Check(incomplete)).toBe(false);
      }
      expectTypeOf(node).toMatchTypeOf<ProgramNode>();
    },
  );

  it.each(['agent', 'script', 'effect', 'consensus', 'sequence', 'plugin'])(
    'rejects forbidden %s nodes',
    (kind) => {
      expect(validate.Check({ kind, id: `sha256:${'1'.repeat(64)}` })).toBe(false);
    },
  );

  const unionSiblings = [
    ...(['agent', 'script', 'effect'] as const).map((activityKind) => ({
      name: `activity/${activityKind}`,
      value: { ...programNodeExamples()[0], activityKind },
    })),
    {
      name: 'parallel/votes',
      value: {
        kind: 'parallel',
        id: programId('4'),
        mode: 'votes',
        branches: [
          {
            key: 'reviewer',
            bindingKey: 'reviewer-binding',
            input: {},
            region: programRegion(),
          },
        ],
        policy: { kind: 'quorum', minimumParticipation: 1 },
        remaining: 'cancel',
        next: programId('9'),
      },
    },
    {
      name: 'map/failFast',
      value: {
        ...programNodeExamples()[5],
        failure: { kind: 'failFast', remaining: 'cancel' },
      },
    },
    {
      name: 'wait/signal',
      value: {
        ...programNodeExamples()[6],
        wait: { kind: 'signal', signal: 'approved', payloadSchema: { type: 'boolean' } },
      },
    },
  ] as const;

  it.each(unionSiblings)('accepts the $name union sibling', ({ value }) => {
    expect(validate.Check(value)).toBe(true);
  });
});
