import { describe, expect, it } from 'vitest';

import {
  PIPELINE_DIAGNOSTIC_CATALOG,
  PIPELINE_LIMITS,
  comparePipelineDiagnostics,
  createPipelineDiagnostic,
  finalizePipelineDiagnostics,
} from '../../src/foundation/index.js';

const captureInvalidDiagnosticInput = (input: unknown): Error => {
  try {
    Reflect.apply(finalizePipelineDiagnostics, undefined, [input]);
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new TypeError('Expected diagnostic finalization to fail.');
};

const diagnosticCodes = [
  'SOURCE_DIAGNOSTIC_LIMIT',
  'SOURCE_GATE_ANSWER_BIJECTION',
  'MATERIALIZATION_POLICY_COUNT',
  'LINK_MODULE_MISSING',
  'LINK_MODULE_OUTCOME_MISMATCH',
  'LINK_RECURSION',
  'DATA_DOMINANCE',
  'DATA_FAILED_EXIT_SCHEMA',
  'DATA_POINTER_MISSING',
  'DATA_POINTER_STATIC',
  'DATA_SCHEMA_INCOMPATIBLE',
  'DATA_SCHEMA_MISMATCH',
  'DATA_SCOPE',
  'BOUND_EXCEEDED',
  'BOUND_OVERFLOW',
  'REQUIREMENT_CONFLICT',
  'REQUIREMENT_MISSING',
  'REQUIREMENT_UNUSED',
  'LOWERING_ID_COLLISION',
  'CANONICAL_INPUT',
] as const;

describe('pipeline diagnostics', () => {
  it('pins the complete frozen code catalog and exact definition fields', () => {
    expect(Object.keys(PIPELINE_DIAGNOSTIC_CATALOG)).toEqual(diagnosticCodes);
    expect(Object.isFrozen(PIPELINE_DIAGNOSTIC_CATALOG)).toBe(true);
    for (const code of diagnosticCodes) {
      const entry = PIPELINE_DIAGNOSTIC_CATALOG[code];
      expect(Object.keys(entry)).toEqual(['family', 'code', 'message']);
      expect(entry.code).toBe(code);
      expect(Object.isFrozen(entry)).toBe(true);
      expect(entry.message.length).toBeLessThanOrEqual(PIPELINE_LIMITS.displayStringCodePoints);
    }
  });

  it('creates exact frozen, catalog-backed, value-redacted diagnostics', () => {
    const diagnostic = createPipelineDiagnostic('DATA_SCHEMA_MISMATCH', '/secret');

    expect(diagnostic).toEqual({
      family: 'DATA',
      code: 'DATA_SCHEMA_MISMATCH',
      path: '/secret',
      message: 'The mapped value does not satisfy its schema.',
    });
    expect(Object.keys(diagnostic)).toEqual(['family', 'code', 'path', 'message']);
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain('provider-payload');
  });

  it('sorts by family priority, Unicode path, then code', () => {
    const diagnostics = finalizePipelineDiagnostics([
      createPipelineDiagnostic('CANONICAL_INPUT', '/a'),
      createPipelineDiagnostic('SOURCE_GATE_ANSWER_BIJECTION', '/z'),
      createPipelineDiagnostic('DATA_SCHEMA_MISMATCH', '/b'),
      createPipelineDiagnostic('DATA_POINTER_STATIC', '/a'),
    ]);

    expect(diagnostics.map(({ family, path }) => `${family}:${path}`)).toEqual([
      'SOURCE:/z',
      'DATA:/a',
      'DATA:/b',
      'CANONICAL:/a',
    ]);
    expect(
      comparePipelineDiagnostics(
        createPipelineDiagnostic('SOURCE_GATE_ANSWER_BIJECTION', '/z'),
        createPipelineDiagnostic('DATA_POINTER_STATIC', '/a'),
      ),
    ).toBeLessThan(0);
  });

  it('compares captured proxy fields without invoking throwing or substituting gets', () => {
    let getCalls = 0;
    const throwing = new Proxy(
      { ...createPipelineDiagnostic('SOURCE_GATE_ANSWER_BIJECTION', '/z') },
      {
        get() {
          getCalls += 1;
          throw new Error('compare-get-secret');
        },
      },
    );
    const substituting = new Proxy(
      { ...createPipelineDiagnostic('DATA_POINTER_STATIC', '/a') },
      {
        get(_target, key) {
          getCalls += 1;
          return key === 'family' ? 'CANONICAL' : '/substituted';
        },
      },
    );

    expect(comparePipelineDiagnostics(throwing, substituting)).toBeLessThan(0);
    expect(
      comparePipelineDiagnostics(substituting, createPipelineDiagnostic('CANONICAL_INPUT', '/a')),
    ).toBeLessThan(0);
    expect(getCalls).toBe(0);
  });

  it('rejects malformed direct comparator inputs with one redacted error', () => {
    const valid = createPipelineDiagnostic('DATA_POINTER_STATIC', '/a');
    const accessor = { ...valid };
    Object.defineProperty(accessor, 'path', {
      enumerable: true,
      get() {
        throw new Error('compare-accessor-secret');
      },
    });
    const descriptorProxy = new Proxy(
      { ...valid },
      {
        getOwnPropertyDescriptor() {
          throw new Error('compare-proxy-secret');
        },
      },
    );

    for (const malformed of [accessor, descriptorProxy, { ...valid, unexpected: true }]) {
      for (const [left, right] of [
        [malformed, valid],
        [valid, malformed],
      ]) {
        let thrown: unknown;
        try {
          Reflect.apply(comparePipelineDiagnostics, undefined, [left, right]);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(TypeError);
        if (!(thrown instanceof Error)) {
          throw new TypeError('Expected an Error instance.');
        }
        expect(thrown.message).toBe('Invalid pipeline diagnostic input.');
        expect(Object.hasOwn(thrown, 'cause')).toBe(false);
      }
    }
  });

  it('captures unbranded diagnostics into exact individually frozen owned values', () => {
    const mutable = { ...createPipelineDiagnostic('DATA_SCHEMA_MISMATCH', '/mutable') };
    const alreadyFrozen = Object.freeze({
      ...createPipelineDiagnostic('CANONICAL_INPUT', '/frozen'),
    });

    const finalized = finalizePipelineDiagnostics([alreadyFrozen, mutable]);
    mutable.path = '/changed';

    expect(finalized).toEqual([
      createPipelineDiagnostic('DATA_SCHEMA_MISMATCH', '/mutable'),
      createPipelineDiagnostic('CANONICAL_INPUT', '/frozen'),
    ]);
    expect(finalized[0]).not.toBe(mutable);
    expect(finalized[1]).not.toBe(alreadyFrozen);
    expect(finalized.every((diagnostic) => Object.isFrozen(diagnostic))).toBe(true);
    expect(Object.isFrozen(finalized)).toBe(true);
  });

  it('sorts only captured descriptor fields without invoking hostile gets', () => {
    let getCalls = 0;
    const input = { ...createPipelineDiagnostic('DATA_SCHEMA_MISMATCH', '/captured') };
    const hostile = new Proxy(input, {
      get() {
        getCalls += 1;
        throw new Error('get-secret');
      },
    });

    const finalized = finalizePipelineDiagnostics([hostile]);

    expect(finalized).toEqual([createPipelineDiagnostic('DATA_SCHEMA_MISMATCH', '/captured')]);
    expect(Object.is(finalized[0], hostile)).toBe(false);
    expect(Object.isFrozen(finalized[0])).toBe(true);
    expect(getCalls).toBe(0);
  });

  it('returns the first 99 ordered diagnostics plus the fixed overflow marker', () => {
    const diagnostics = Array.from({ length: PIPELINE_LIMITS.diagnostics + 1 }, (_, index) =>
      createPipelineDiagnostic('DATA_SCHEMA_MISMATCH', `/p${String(index).padStart(3, '0')}`),
    );
    const finalized = finalizePipelineDiagnostics(diagnostics);

    expect(finalized).toHaveLength(PIPELINE_LIMITS.diagnostics);
    expect(finalized.at(-1)).toEqual({
      family: 'SOURCE',
      code: 'SOURCE_DIAGNOSTIC_LIMIT',
      path: '',
      message: 'The diagnostic limit was exceeded.',
    });
    expect(finalized[0]?.path).toBe('/p000');
    expect(finalized[98]?.path).toBe('/p098');
    expect(Object.isFrozen(finalized)).toBe(true);
  });

  it('rejects unknown codes and invalid pointers without property coercion', () => {
    let coercionCalls = 0;
    const hostile = new Proxy(
      {},
      {
        get() {
          coercionCalls += 1;
          throw new Error('diagnostic-secret');
        },
      },
    );

    for (const [code, path] of [
      ['DATA_UNKNOWN', ''],
      ['DATA_SCHEMA_MISMATCH', 'not-a-pointer'],
      [hostile, ''],
      ['DATA_SCHEMA_MISMATCH', hostile],
    ]) {
      expect(() => {
        Reflect.apply(createPipelineDiagnostic, undefined, [code, path]);
      }).toThrow('Invalid pipeline diagnostic input.');
    }
    expect(coercionCalls).toBe(0);
  });

  it('rejects accessor, proxy, and revoked diagnostic lists with a redacted error', () => {
    const valid = createPipelineDiagnostic('DATA_SCHEMA_MISMATCH', '');
    const accessorList: unknown[] = [];
    Object.defineProperty(accessorList, '0', {
      enumerable: true,
      get() {
        throw new Error('getter-secret');
      },
    });
    accessorList.length = 1;
    const proxyList = new Proxy([valid], {
      ownKeys() {
        throw new Error('proxy-secret');
      },
    });
    const revoked = Proxy.revocable([valid], {});
    revoked.revoke();

    for (const list of [accessorList, proxyList, revoked.proxy]) {
      const error = captureInvalidDiagnosticInput(list);
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe('Invalid pipeline diagnostic input.');
      expect(Object.hasOwn(error, 'cause')).toBe(false);
    }
  });

  it('rejects malformed and hostile diagnostic entries with one redacted error', () => {
    const valid = createPipelineDiagnostic('DATA_SCHEMA_MISMATCH', '');
    const accessor = { ...valid };
    Object.defineProperty(accessor, 'path', {
      enumerable: true,
      get() {
        throw new Error('entry-getter-secret');
      },
    });
    const descriptorProxy = new Proxy(
      { ...valid },
      {
        getOwnPropertyDescriptor() {
          throw new Error('entry-proxy-secret');
        },
      },
    );
    const revoked = Proxy.revocable({ ...valid }, {});
    revoked.revoke();

    for (const diagnostic of [
      accessor,
      descriptorProxy,
      revoked.proxy,
      { ...valid, unexpected: true },
      { ...valid, family: 'CANONICAL' },
      Object.assign(Object.create(Date.prototype), valid),
    ]) {
      const error = captureInvalidDiagnosticInput([diagnostic]);
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe('Invalid pipeline diagnostic input.');
      expect(Object.hasOwn(error, 'cause')).toBe(false);
    }
  });
});
