import { Compile } from 'typebox/compile';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ProfileMaterializationSchema,
  type ProfileMaterialization,
  validateProfileMaterialization,
} from '../../src/materialization/index.js';
import {
  expectValidMaterialization,
  materializationDiagnostics,
  singleMaterialization,
  validatedSource,
} from '../support/materialization-builders.js';
import { agentSource } from '../support/source-builders.js';

const materializationValidator = Compile(ProfileMaterializationSchema);

const nestedArray = (depth: number): unknown => {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) {
    value = [value];
  }
  return value;
};

describe('materialization contract', () => {
  it('exports one closed runtime and exact static contract', () => {
    const source = validatedSource();
    const materialization = singleMaterialization(source.sourceDigest);

    expect(materializationValidator.Check(materialization)).toBe(true);
    expect(materializationValidator.Check({ ...materialization, undeclared: true })).toBe(false);
    expectTypeOf(materialization).toEqualTypeOf<ProfileMaterialization>();
  });

  it.each([
    ['unknown version', 'schemaVersion', 'pipeline-materialization/v2', '/schemaVersion'],
    ['malformed digest', 'sourceDigest', 'bad', '/sourceDigest'],
  ] as const)('rejects %s at its owning field', (_name, field, value, path) => {
    const source = validatedSource();
    const input = { ...singleMaterialization(source.sourceDigest), [field]: value };
    expect(materializationDiagnostics(input, source)[0]).toEqual({ code: 'CANONICAL_INPUT', path });
  });

  it('totalizes revoked, deep, and invalid-key materialization input', () => {
    const source = validatedSource();
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    expect(() => validateProfileMaterialization(source, revoked.proxy)).not.toThrow();
    expect(materializationDiagnostics(revoked.proxy, source)).toEqual([
      { code: 'CANONICAL_INPUT', path: '' },
    ]);
    const deep = materializationDiagnostics(
      { ...singleMaterialization(source.sourceDigest), extra: nestedArray(2_000) },
      source,
    );
    expect(deep[0]?.code).toBe('CANONICAL_INPUT');
    expect(deep[0]?.path).toMatch(/^\/extra(?:\/0)+$/u);

    for (const key of ['e\u0301', '\ud800']) {
      const invalidKey = {};
      Object.defineProperty(invalidKey, key, { enumerable: true, value: null });
      expect(
        materializationDiagnostics(
          { ...singleMaterialization(source.sourceDigest), extra: invalidKey },
          source,
        ),
      ).toEqual([{ code: 'CANONICAL_INPUT', path: '/extra' }]);
    }
  });
});

describe('materialization schema', () => {
  it('accepts both strategies and applies participant bounds', () => {
    const sourcePackage = agentSource();
    const module = sourcePackage.modules[0];
    const agent = module.region.nodes[0];
    if (agent?.kind !== 'agent') {
      throw new TypeError('Expected normalized agent node.');
    }
    const source = validatedSource({
      ...sourcePackage,
      modules: [
        {
          ...module,
          region: {
            ...module.region,
            nodes: [
              {
                ...agent,
                strategies: [
                  ...agent.strategies,
                  {
                    kind: 'consensus',
                    minimumParticipants: 2,
                    maximumParticipants: 3,
                    policy: { kind: 'quorum', minimumParticipation: 2 },
                    remaining: 'cancel',
                    routes: {
                      approved: 'done',
                      rejected: 'done',
                      inconclusive: 'done',
                      participantFailed: 'done',
                      cancelled: 'done',
                    },
                  },
                ],
              },
              ...module.region.nodes.slice(1),
            ],
          },
        },
      ],
    });
    const consensus: ProfileMaterialization = {
      ...singleMaterialization(source.sourceDigest),
      slots: [
        {
          sourcePath: '/modules/0/region/nodes/0',
          slotKey: 'review',
          selection: {
            strategy: 'consensus',
            participants: [
              { key: 'right', bindingKey: 'b2' },
              { key: 'left', bindingKey: 'b1' },
            ],
          },
        },
      ],
    };

    const normalized = expectValidMaterialization(consensus, source);
    expect(normalized.materialization.slots[0]?.selection).toEqual({
      strategy: 'consensus',
      participants: [
        { key: 'left', bindingKey: 'b1' },
        { key: 'right', bindingKey: 'b2' },
      ],
    });

    const underMinimum = {
      ...consensus,
      slots: [
        {
          ...consensus.slots[0],
          selection: {
            strategy: 'consensus',
            participants: [{ key: 'left', bindingKey: 'b1' }],
          },
        },
      ],
    };
    expect(materializationDiagnostics(underMinimum, source)).toContainEqual({
      code: 'MATERIALIZATION_POLICY_COUNT',
      path: '/slots/0/selection/participants',
    });
  });

  it('maps an empty participant array directly to the policy-count diagnostic', () => {
    const source = validatedSource();
    const materialization = singleMaterialization(source.sourceDigest);
    const input = {
      ...materialization,
      slots: [
        {
          ...materialization.slots[0],
          selection: { strategy: 'consensus', participants: [] },
        },
      ],
    };

    expect(materializationDiagnostics(input, source)).toEqual([
      { code: 'MATERIALIZATION_POLICY_COUNT', path: '/slots/0/selection/participants' },
    ]);
  });

  it('reports a single participant identifier at its direct field path', () => {
    const source = validatedSource();
    const materialization = singleMaterialization(source.sourceDigest);
    const input = {
      ...materialization,
      slots: [
        {
          ...materialization.slots[0],
          selection: {
            strategy: 'single',
            participant: { key: '', bindingKey: 'binding' },
          },
        },
      ],
    };

    expect(materializationDiagnostics(input, source)).toContainEqual({
      code: 'CANONICAL_INPUT',
      path: '/slots/0/selection/participant/key',
    });
  });
});
