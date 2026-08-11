import { Compile } from 'typebox/compile';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  PipelineSourcePackageSchema,
  type PipelineSourcePackage,
  validatePipelineSource,
} from '../../../src/source/index.js';
import { agentSource } from '../../support/source-builders.js';
import { sourceDiagnostics } from '../../support/source-validation.js';

const sourceValidator = Compile(PipelineSourcePackageSchema);

const nestedArray = (depth: number): unknown => {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) {
    value = [value];
  }
  return value;
};

const sourceWithLiteral = (value: unknown): unknown => {
  const source = agentSource();
  const module = source.modules[0];
  const [agent, ...rest] = module.region.nodes;
  return {
    ...source,
    modules: [
      {
        ...module,
        region: {
          ...module.region,
          nodes: [{ ...agent, input: { value: { kind: 'literal', value } } }, ...rest],
        },
      },
    ],
  };
};

describe('source contract', () => {
  it('exports one exact runtime and static package contract', () => {
    const source = agentSource();

    expect(sourceValidator.Check(source)).toBe(true);
    expectTypeOf(source).toEqualTypeOf<PipelineSourcePackage>();
    expect(PipelineSourcePackageSchema).toMatchObject({ additionalProperties: false });
  });

  it.each([
    ['unknown package field', { ...agentSource(), extra: true }, '/extra'],
    [
      'missing version',
      (({ schemaVersion: _, ...value }) => value)(agentSource()),
      '/schemaVersion',
    ],
    [
      'unknown version',
      { ...agentSource(), schemaVersion: 'pipeline-source/v2' },
      '/schemaVersion',
    ],
  ])('rejects %s at the owning field', (_name, source, path) => {
    expect(sourceDiagnostics(source)[0]).toEqual({ code: 'CANONICAL_INPUT', path });
  });

  it('dispatches a malformed tagged union once at its discriminator', () => {
    const base = agentSource();
    const module = base.modules[0];
    const region = module.region;
    const node = region.nodes[0];
    const source = {
      ...base,
      modules: [
        {
          ...module,
          region: { ...region, nodes: [{ ...node, kind: 'mystery' }, ...region.nodes.slice(1)] },
        },
      ],
    };

    expect(sourceDiagnostics(source)).toEqual([
      { code: 'CANONICAL_INPUT', path: '/modules/0/region/nodes/0/kind' },
    ]);
  });

  it('totalizes revoked proxies and deeply nested embedded literals', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    expect(() => validatePipelineSource(revoked.proxy)).not.toThrow();
    expect(sourceDiagnostics(revoked.proxy)).toEqual([{ code: 'CANONICAL_INPUT', path: '' }]);
    expect(sourceDiagnostics(sourceWithLiteral(revoked.proxy))).toEqual([
      {
        code: 'CANONICAL_INPUT',
        path: '/modules/0/region/nodes/0/input/value/value',
      },
    ]);
    const deep = sourceDiagnostics(sourceWithLiteral(nestedArray(5_000)));
    expect(deep).toHaveLength(1);
    expect(deep[0]?.code).toBe('CANONICAL_INPUT');
    expect(deep[0]?.path).toMatch(/^\/modules\/0\/region\/nodes\/0\/input\/value\/value(?:\/0)+$/u);
  });

  it.each(['e\u0301', '\ud800'])(
    'keeps invalid key rejection at the valid containing path',
    (key) => {
      const literal = {};
      Object.defineProperty(literal, key, { enumerable: true, value: null });

      expect(sourceDiagnostics(sourceWithLiteral(literal))).toEqual([
        {
          code: 'CANONICAL_INPUT',
          path: '/modules/0/region/nodes/0/input/value/value',
        },
      ]);
    },
  );
});
