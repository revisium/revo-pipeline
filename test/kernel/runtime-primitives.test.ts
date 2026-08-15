import { describe, expect, it } from 'vitest';

import type { ProgramRepeatCondition } from '../../src/program/index.js';
import {
  evaluateRepeatCondition,
  readPipelineFailure,
  safeInput,
  type SelectorEnvironment,
} from '../support/kernel-internal.js';

const environment: SelectorEnvironment = {
  moduleInput: {},
  scopeInput: { flag: true, scalar: 'x', object: {} },
  nodeResults: {},
};

const evaluate = (condition: ProgramRepeatCondition) =>
  evaluateRepeatCondition(condition, environment);

describe('structured runtime primitives', () => {
  it.each([
    [
      {
        kind: 'all',
        conditions: [
          {
            kind: 'equals',
            selector: { kind: 'scopeInput', pointer: '/flag' },
            value: true,
          },
          {
            kind: 'oneOf',
            selector: { kind: 'scopeInput', pointer: '/scalar' },
            values: ['x', 'y'],
          },
        ],
      },
      { ok: true, value: true },
    ],
    [
      {
        kind: 'any',
        conditions: [
          {
            kind: 'equals',
            selector: { kind: 'literal', value: false },
            value: true,
          },
          {
            kind: 'equals',
            selector: { kind: 'literal', value: true },
            value: true,
          },
        ],
      },
      { ok: true, value: true },
    ],
    [
      {
        kind: 'not',
        condition: {
          kind: 'exists',
          selector: { kind: 'scopeInput', pointer: '/missing' },
        },
      },
      { ok: true, value: true },
    ],
    [
      {
        kind: 'equals',
        selector: { kind: 'scopeInput', pointer: '/object' },
        value: null,
      },
      { ok: false, path: '/object' },
    ],
    [
      {
        kind: 'all',
        conditions: [
          {
            kind: 'equals',
            selector: { kind: 'scopeInput', pointer: '/missing' },
            value: true,
          },
          {
            kind: 'equals',
            selector: { kind: 'literal', value: true },
            value: true,
          },
        ],
      },
      { ok: false, path: '/missing' },
    ],
  ] satisfies readonly (readonly [ProgramRepeatCondition, unknown])[])(
    'evaluates recursive condition %j',
    (condition, expected) => {
      expect(evaluate(condition)).toEqual(expected);
    },
  );

  it.each([
    [null, null, true],
    [true, true, true],
    [false, true, false],
    [42, 42, true],
    [-0, 0, true],
    ['é', 'é', true],
  ] as const)('uses canonical scalar identity for %j and %j', (value, candidate, expected) => {
    const equals: ProgramRepeatCondition = {
      kind: 'equals',
      selector: { kind: 'literal', value },
      value: candidate,
    };
    const oneOf: ProgramRepeatCondition = {
      kind: 'oneOf',
      selector: { kind: 'literal', value },
      values: [candidate],
    };
    expect(evaluate(equals)).toEqual({ ok: true, value: expected });
    expect(evaluate(oneOf)).toEqual({ ok: true, value: expected });
  });

  it.each([
    [
      { code: 'DECLARED', path: '/value' },
      { code: 'DECLARED', path: '/value' },
    ],
    [null, { code: 'DATA_SCHEMA_MISMATCH', path: '' }],
    [[], { code: 'DATA_SCHEMA_MISMATCH', path: '' }],
    [
      { code: 1, path: '' },
      { code: 'DATA_SCHEMA_MISMATCH', path: '' },
    ],
    [
      { code: 'X', path: 'not-a-pointer' },
      { code: 'DATA_SCHEMA_MISMATCH', path: '' },
    ],
    [
      { code: 'X', path: '', extra: true },
      { code: 'DATA_SCHEMA_MISMATCH', path: '' },
    ],
  ] as const)('reads only an exact Pipeline failure from %j', (value, expected) => {
    expect(readPipelineFailure(value)).toEqual(expected);
  });

  it('totalizes defensive state input', () => {
    expect(safeInput({ accepted: true })).toEqual({ accepted: true });
    expect(safeInput(Symbol('invalid'))).toBeNull();
  });
});
