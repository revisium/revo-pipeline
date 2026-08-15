import { Compile } from 'typebox/compile';
import { describe, expect, it } from 'vitest';

import { ProgramNodeSchema, ProgramRegionSchema } from '../../../src/program/index.js';
import { programId, programNodeExamples, programRegion } from '../../support/program-builders.js';

const validate = Compile(ProgramNodeSchema);
const validateRegion = Compile(ProgramRegionSchema);

const programRegionFields = [
  'id',
  'inputSchema',
  'entry',
  'outputSchema',
  'exits',
  'nodes',
] as const;
const programExitFields = ['outcome', 'outputSchema'] as const;

const programNodeShapeVectors = [
  [
    'activity',
    [
      'kind',
      'id',
      'activityKind',
      'requirementKey',
      'input',
      'inputSchema',
      'outputSchema',
      'routes',
    ],
  ],
  ['choice', ['kind', 'id', 'selector', 'cases', 'otherwise']],
  ['call', ['kind', 'id', 'module', 'input', 'outputSchema', 'routes']],
  ['parallel', ['kind', 'id', 'mode', 'branches', 'policy', 'remaining', 'next']],
  [
    'repeat',
    [
      'kind',
      'id',
      'maximumIterations',
      'initialInput',
      'nextInput',
      'body',
      'bodyExits',
      'continueWhen',
      'output',
      'outputSchema',
      'routes',
    ],
  ],
  [
    'map',
    [
      'kind',
      'id',
      'items',
      'itemKeyPointer',
      'maximumItems',
      'maximumConcurrency',
      'bodyInput',
      'body',
      'bodyExits',
      'failure',
      'routes',
    ],
  ],
  ['wait', ['kind', 'id', 'wait', 'routes']],
  ['humanGate', ['kind', 'id', 'subject', 'answers', 'authorizationRequirements', 'routes']],
  ['end', ['kind', 'id', 'outcome', 'output']],
] as const;

describe('closed Program node union', () => {
  it.each(programNodeShapeVectors)(
    'pins the independent %s runtime shape vector',
    (kind, fields) => {
      const node = programNodeExamples().find((candidate) => candidate.kind === kind);
      expect(node).toBeDefined();
      if (node === undefined) {
        throw new TypeError('Expected a Program node shape fixture.');
      }
      expect(Object.keys(node).toSorted()).toEqual([...fields].toSorted());
      expect(validate.Check(node)).toBe(true);
      expect(validate.Check({ ...node, undeclared: true })).toBe(false);
      for (const field of fields) {
        const incomplete: Record<string, unknown> = { ...node };
        delete incomplete[field];
        expect(validate.Check(incomplete)).toBe(false);
      }
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

  it('pins the independent ProgramRegion and exit runtime shapes', () => {
    const region = programRegion();
    const exit = region.exits[0];

    expect(Object.keys(region).toSorted()).toEqual([...programRegionFields].toSorted());
    expect(Object.keys(exit).toSorted()).toEqual([...programExitFields].toSorted());
    expect(validateRegion.Check(region)).toBe(true);
    expect(validateRegion.Check({ ...region, undeclared: true })).toBe(false);
    expect(validateRegion.Check({ ...region, exits: [{ ...exit, undeclared: true }] })).toBe(false);

    for (const field of programRegionFields) {
      const incomplete: Record<string, unknown> = { ...region };
      delete incomplete[field];
      expect(validateRegion.Check(incomplete)).toBe(false);
    }
    for (const field of programExitFields) {
      const incompleteExit: Record<string, unknown> = { ...exit };
      delete incompleteExit[field];
      expect(validateRegion.Check({ ...region, exits: [incompleteExit] })).toBe(false);
    }
  });

  it.each(programNodeExamples().map((node) => [node.kind, node] as const))(
    'contains a representative %s node in ProgramRegionSchema',
    (_kind, node) => {
      expect(validateRegion.Check(programRegion([node]))).toBe(true);
    },
  );
});
