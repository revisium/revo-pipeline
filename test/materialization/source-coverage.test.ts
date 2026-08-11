import { describe, expect, it } from 'vitest';

import type { ProfileMaterialization } from '../../src/materialization/index.js';
import type { SourceNode } from '../../src/source/index.js';
import {
  expectValidMaterialization,
  materializationDiagnostics,
  singleMaterialization,
  validatedSource,
} from '../support/materialization-builders.js';
import { endNode, sourceNodeBuilders, sourceWithNodes } from '../support/source-builders.js';

describe('materialization source validation', () => {
  it.each([
    [
      'source digest',
      (value: ProfileMaterialization) => ({ ...value, sourceDigest: `sha256:${'0'.repeat(64)}` }),
      '/sourceDigest',
    ],
    [
      'slot key',
      (value: ProfileMaterialization) => ({
        ...value,
        slots: [{ ...value.slots[0]!, slotKey: 'other' }],
      }),
      '/slots/0/slotKey',
    ],
    [
      'source path',
      (value: ProfileMaterialization) => ({
        ...value,
        slots: [{ ...value.slots[0]!, sourcePath: '/modules/0/region/nodes/1' }],
      }),
      '/slots/0/sourcePath',
    ],
    [
      'strategy',
      (value: ProfileMaterialization) => ({
        ...value,
        slots: [
          {
            ...value.slots[0]!,
            selection: { strategy: 'consensus', participants: [{ key: 'a', bindingKey: 'a' }] },
          },
        ],
      }),
      '/slots/0/selection/strategy',
    ],
  ] as const)('rejects a mismatched %s', (_name, mutate, path) => {
    const source = validatedSource();
    expect(
      materializationDiagnostics(mutate(singleMaterialization(source.sourceDigest)), source),
    ).toContainEqual({ code: 'CANONICAL_INPUT', path });
  });

  it('requires exactly one slot for every reachable agent', () => {
    const source = validatedSource();
    const materialization = singleMaterialization(source.sourceDigest);

    expect(materializationDiagnostics({ ...materialization, slots: [] }, source)).toEqual([
      { code: 'CANONICAL_INPUT', path: '/slots' },
    ]);
    expect(
      materializationDiagnostics(
        { ...materialization, slots: [materialization.slots[0]!, materialization.slots[0]!] },
        source,
      ),
    ).toContainEqual({
      code: 'CANONICAL_INPUT',
      path: '/slots/1/sourcePath',
    });
  });

  it('allows the same slotKey at distinct canonical source paths', () => {
    const example = sourceNodeBuilders.agent();
    const first: SourceNode = {
      ...example,
      key: 'a',
      strategies: [
        {
          kind: 'single',
          routes: { succeeded: 'b', failed: 'b', cancelled: 'b' },
        },
      ],
    };
    const second: SourceNode = { ...example, key: 'b' };
    const source = validatedSource(sourceWithNodes([first, second, endNode()]));
    const participant = { key: 'participant', bindingKey: 'binding' };
    const materialization: ProfileMaterialization = {
      schemaVersion: 'pipeline-materialization/v1',
      sourceDigest: source.sourceDigest,
      slots: [
        {
          sourcePath: '/modules/0/region/nodes/1',
          slotKey: 'review',
          selection: { strategy: 'single', participant },
        },
        {
          sourcePath: '/modules/0/region/nodes/0',
          slotKey: 'review',
          selection: { strategy: 'single', participant },
        },
      ],
    };

    expect(
      expectValidMaterialization(materialization, source).materialization.slots.map(
        ({ sourcePath }) => sourcePath,
      ),
    ).toEqual(['/modules/0/region/nodes/0', '/modules/0/region/nodes/1']);
  });
});
