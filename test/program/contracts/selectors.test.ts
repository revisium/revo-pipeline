import type { Static } from 'typebox';
import { Compile } from 'typebox/compile';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ProgramRepeatConditionSchema,
  ProgramValueSelectorSchema,
  type ProgramRepeatCondition,
  type ProgramValueSelector,
} from '../../../src/program/index.js';
import { programId } from '../../support/program-builders.js';

const selectorValidator = Compile(ProgramValueSelectorSchema);
const conditionValidator = Compile(ProgramRepeatConditionSchema);

describe('closed Program selectors', () => {
  it('keeps selector and condition runtime schemas aligned with static contracts', () => {
    expectTypeOf<Static<typeof ProgramValueSelectorSchema>>().toEqualTypeOf<ProgramValueSelector>();
    expectTypeOf<
      Static<typeof ProgramRepeatConditionSchema>
    >().toEqualTypeOf<ProgramRepeatCondition>();
  });

  const selectors = [
    { kind: 'literal', value: { answer: true } },
    { kind: 'moduleInput', pointer: '/value' },
    { kind: 'scopeInput', pointer: '/value' },
    { kind: 'nodeOutput', nodeId: programId(), pointer: '/result' },
    { kind: 'nodeFailure', nodeId: programId(), pointer: '/code' },
    { kind: 'regionOutput', pointer: '/value' },
    { kind: 'repeat', value: 'iteration', pointer: '' },
    { kind: 'map', value: 'itemKey', pointer: '' },
  ] as const satisfies readonly ProgramValueSelector[];

  it.each(selectors.map((selector) => [selector.kind, selector] as const))(
    'accepts the exact %s selector runtime/static contract',
    (_kind, selector) => {
      expect(selectorValidator.Check(selector)).toBe(true);
      expect(selectorValidator.Check({ ...selector, undeclared: true })).toBe(false);
      for (const field of Object.keys(selector)) {
        const incomplete = { ...selector } as Record<string, unknown>;
        delete incomplete[field];
        expect(selectorValidator.Check(incomplete)).toBe(false);
      }
      expectTypeOf(selector).toMatchTypeOf<ProgramValueSelector>();
    },
  );

  const nodeSelector = selectors[3];
  const conditions = [
    { kind: 'equals', selector: nodeSelector, value: true },
    { kind: 'oneOf', selector: nodeSelector, values: [true, false] },
    { kind: 'exists', selector: nodeSelector },
    {
      kind: 'all',
      conditions: [
        { kind: 'exists', selector: nodeSelector },
        { kind: 'equals', selector: nodeSelector, value: true },
      ],
    },
    {
      kind: 'any',
      conditions: [
        { kind: 'exists', selector: nodeSelector },
        { kind: 'equals', selector: nodeSelector, value: true },
      ],
    },
    { kind: 'not', condition: { kind: 'exists', selector: nodeSelector } },
  ] as const satisfies readonly ProgramRepeatCondition[];

  it.each(conditions.map((condition) => [condition.kind, condition] as const))(
    'accepts recursive %s conditions and rejects undeclared fields',
    (_kind, condition) => {
      expect(conditionValidator.Check(condition)).toBe(true);
      expect(conditionValidator.Check({ ...condition, undeclared: true })).toBe(false);
      for (const field of Object.keys(condition)) {
        const incomplete = { ...condition } as Record<string, unknown>;
        delete incomplete[field];
        expect(conditionValidator.Check(incomplete)).toBe(false);
      }
      expectTypeOf(condition).toMatchTypeOf<ProgramRepeatCondition>();
    },
  );

  it('rejects source node keys and unknown fields', () => {
    expect(selectorValidator.Check({ kind: 'nodeOutput', node: 'source-key', pointer: '' })).toBe(
      false,
    );
    expect(selectorValidator.Check({ kind: 'scopeInput', pointer: '', executable: true })).toBe(
      false,
    );
    expect(
      selectorValidator.Check({ kind: 'nodeFailure', nodeId: 'source-key', pointer: '' }),
    ).toBe(false);
    expect(conditionValidator.Check({ kind: 'all', conditions: [] })).toBe(false);
    expect(conditionValidator.Check({ kind: 'oneOf', selector: selectors[0], values: [] })).toBe(
      false,
    );
  });
});
