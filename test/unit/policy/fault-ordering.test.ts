import { describe, expect, test } from 'vitest';

import type { DecisionFault, DefinitionFault } from '../../../src/errors/index.js';
import {
  DECISION_FAULT_PHASES,
  DEFINITION_FAULT_PHASES,
  orderFaults,
  PIPELINE_LIMITS,
} from '../../../src/policy/index.js';

describe('deterministic bounded fault ordering', () => {
  test('orders definition faults by phase, code-point path and lexical code', () => {
    const faults: readonly DefinitionFault[] = [
      { code: 'DEF_CYCLE', path: '/a', message: 'dag' },
      { code: 'DEF_SCHEMA', path: '/z', message: 'shape' },
      { code: 'DEF_TYPE', path: '/\u{10000}', message: 'later code point' },
      { code: 'DEF_TYPE', path: '/\ue000', message: 'earlier code point' },
      { code: 'DEF_UNKNOWN_FIELD', path: '/a', message: 'second code' },
      { code: 'DEF_TYPE', path: '/a', message: 'first code' },
    ];

    expect(orderFaults(faults, DEFINITION_FAULT_PHASES, 'DEF_LIMIT', 'definition')).toEqual([
      { code: 'DEF_TYPE', path: '/a', message: 'first code' },
      { code: 'DEF_UNKNOWN_FIELD', path: '/a', message: 'second code' },
      { code: 'DEF_SCHEMA', path: '/z', message: 'shape' },
      { code: 'DEF_TYPE', path: '/\ue000', message: 'earlier code point' },
      { code: 'DEF_TYPE', path: '/\u{10000}', message: 'later code point' },
      { code: 'DEF_CYCLE', path: '/a', message: 'dag' },
    ]);
  });

  test('uses exact cross-class decision phases', () => {
    const faults: readonly DecisionFault[] = [
      { code: 'FACT_CAUSAL', path: '/a', message: 'causal' },
      { code: 'FACT_LIMIT', path: '/a', message: 'limit' },
      { code: 'PIPELINE_INVALID', path: '/z', message: 'compiled' },
      { code: 'FACT_RESOLUTION', path: '/a', message: 'resolution' },
      { code: 'FACT_DUPLICATE', path: '/a', message: 'duplicate' },
    ];
    expect(
      orderFaults(faults, DECISION_FAULT_PHASES, 'FACT_LIMIT', 'decision').map(({ code }) => code),
    ).toEqual([
      'PIPELINE_INVALID',
      'FACT_LIMIT',
      'FACT_DUPLICATE',
      'FACT_RESOLUTION',
      'FACT_CAUSAL',
    ]);
  });

  test('bounds text and replaces overflow with the root truncation fault', () => {
    const faults: DefinitionFault[] = Array.from(
      { length: PIPELINE_LIMITS.faults + 1 },
      (_, index) => ({
        code: 'DEF_TYPE',
        path: `/${String(index).padStart(3, '0')}${'p'.repeat(2_000)}`,
        message: 'm'.repeat(1_000),
      }),
    );
    const result = orderFaults(faults, DEFINITION_FAULT_PHASES, 'DEF_LIMIT', 'definition');
    expect(result).toHaveLength(PIPELINE_LIMITS.faults);
    expect(result.at(-1)).toEqual({
      code: 'DEF_LIMIT',
      path: '',
      message: 'Fault limit exceeded.',
    });
    expect(result[0]?.path).toHaveLength(PIPELINE_LIMITS.portable.pathCharacters);
    expect(result[0]?.message).toHaveLength(PIPELINE_LIMITS.portable.messageCharacters);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    faults[0] = { code: 'DEF_CYCLE', path: '/changed', message: 'changed' };
    expect(result[0]).not.toMatchObject({ path: '/changed' });
  });

  test('returns all faults when the limit is not exceeded', () => {
    const faults: DecisionFault[] = [
      { code: 'FACT_CAUSAL', path: '/z', message: 'causal' },
      { code: 'FACT_TYPE', path: '/a', message: 'invalid' },
    ];
    const result = orderFaults(faults, DECISION_FAULT_PHASES, 'FACT_LIMIT', 'decision');
    expect(result).toEqual([
      { code: 'FACT_TYPE', path: '/a', message: 'invalid' },
      { code: 'FACT_CAUSAL', path: '/z', message: 'causal' },
    ]);
    expect(
      orderFaults([...faults].reverse(), DECISION_FAULT_PHASES, 'FACT_LIMIT', 'decision'),
    ).toEqual(result);
  });

  test('uses lexical definition codes when phase and path tie', () => {
    const faults: DefinitionFault[] = [
      { code: 'DEF_TYPE', path: '/same', message: 'type' },
      { code: 'DEF_SCHEMA', path: '/same', message: 'schema' },
      { code: 'DEF_UNKNOWN_FIELD', path: '/same', message: 'unknown' },
    ];
    expect(
      orderFaults(faults, DEFINITION_FAULT_PHASES, 'DEF_LIMIT', 'definition').map(
        ({ code }) => code,
      ),
    ).toEqual(['DEF_SCHEMA', 'DEF_TYPE', 'DEF_UNKNOWN_FIELD']);
  });

  test('globally sorts shuffled overflow before retaining the first 99', () => {
    const faults: DefinitionFault[] = Array.from({ length: 140 }, (_, index) => ({
      code: 'DEF_TYPE',
      path: `/${String(index).padStart(3, '0')}`,
      message: String(index),
    }));
    const adversarial = [...faults.slice(70), ...faults.slice(0, 70)].reverse();
    const expected = orderFaults(faults, DEFINITION_FAULT_PHASES, 'DEF_LIMIT', 'definition');
    const actual = orderFaults(adversarial, DEFINITION_FAULT_PHASES, 'DEF_LIMIT', 'definition');
    expect(actual).toEqual(expected);
    expect(actual[0]).toMatchObject({ path: '/000' });
    expect(actual[98]).toMatchObject({ path: '/098' });
    expect(actual[99]).toEqual({
      code: 'DEF_LIMIT',
      path: '',
      message: 'Fault limit exceeded.',
    });
  });

  test('returns all 100 globally ordered faults without a truncation sentinel', () => {
    const faults: DecisionFault[] = Array.from({ length: 100 }, (_, index) => ({
      code: 'FACT_TYPE',
      path: `/${String(99 - index).padStart(3, '0')}`,
      message: String(index),
    }));
    const result = orderFaults(faults, DECISION_FAULT_PHASES, 'FACT_LIMIT', 'decision');
    expect(result).toHaveLength(100);
    expect(result[0]).toMatchObject({ code: 'FACT_TYPE', path: '/000' });
    expect(result[99]).toMatchObject({ code: 'FACT_TYPE', path: '/099' });
    expect(result).not.toContainEqual({
      code: 'FACT_LIMIT',
      path: '',
      message: 'Fault limit exceeded.',
    });
  });
});
