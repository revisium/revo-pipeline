import { describe, expect, it } from 'vitest';

import type { ProgramValueSelector } from '../../src/program/index.js';
import {
  choiceMatches,
  resolveMapping,
  resolveSelector,
  type SelectorEnvironment,
} from '../support/kernel-internal.js';
import { programId } from '../support/program-builders.js';

const succeededId = programId('1');
const failedId = programId('2');
const environment = {
  moduleInput: { module: { value: 'module' } },
  scopeInput: { scope: { value: 'scope' } },
  nodeResults: {
    [succeededId]: { status: 'succeeded' as const, output: { value: 'output' } },
    [failedId]: { status: 'failed' as const, failure: { code: 'FAILED', path: '/value' } },
  },
  regionOutput: { value: 'region' },
} satisfies SelectorEnvironment;

describe('kernel selector semantics', () => {
  it.each([
    [{ kind: 'literal', value: 'literal' }, 'literal'],
    [{ kind: 'moduleInput', pointer: '/module/value' }, 'module'],
    [{ kind: 'scopeInput', pointer: '/scope/value' }, 'scope'],
    [{ kind: 'nodeOutput', nodeId: succeededId, pointer: '/value' }, 'output'],
    [{ kind: 'nodeFailure', nodeId: failedId, pointer: '/code' }, 'FAILED'],
    [{ kind: 'regionOutput', pointer: '/value' }, 'region'],
  ] satisfies readonly (readonly [ProgramValueSelector, string])[])(
    'resolves %s from the owning environment',
    (selector, expected) => {
      expect(resolveSelector(selector, environment)).toEqual({ ok: true, value: expected });
    },
  );

  it.each([
    { kind: 'nodeOutput', nodeId: failedId, pointer: '' },
    { kind: 'nodeFailure', nodeId: succeededId, pointer: '' },
    { kind: 'regionOutput', pointer: '/missing' },
    { kind: 'repeat', value: 'iteration', pointer: '' },
    { kind: 'map', value: 'item', pointer: '' },
  ] satisfies readonly ProgramValueSelector[])(
    'reports the attempted pointer for an unavailable %s selector',
    (selector) => {
      expect(resolveSelector(selector, environment)).toEqual({
        ok: false,
        path: 'pointer' in selector ? selector.pointer : '',
      });
    },
  );

  it('builds mappings in canonical key order and stops on a missing selector', () => {
    expect(
      resolveMapping(
        {
          z: { kind: 'scopeInput', pointer: '/scope/value' },
          a: { kind: 'literal', value: 1 },
        },
        environment,
      ),
    ).toEqual({ ok: true, value: { a: 1, z: 'scope' } });
    expect(resolveMapping({ a: { kind: 'scopeInput', pointer: '/missing' } }, environment)).toEqual(
      { ok: false, path: '/missing' },
    );
  });

  it('matches only canonical scalar choice domains', () => {
    expect(choiceMatches(true, { kind: 'equals', value: true })).toBe(true);
    expect(choiceMatches(1, { kind: 'oneOf', values: [false, 1] })).toBe(true);
    expect(choiceMatches('1', { kind: 'equals', value: 1 })).toBe(false);
    expect(choiceMatches({}, { kind: 'oneOf', values: [null] })).toBe(false);
  });
});
