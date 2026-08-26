import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../src/index.js';
import { validatePipelineSelections } from '../../src/materialization/index.js';
import { validatedSource } from '../support/materialization-builders.js';
import { endNode, sourceNodeBuilders, sourceWithNodes } from '../support/source-builders.js';

describe('selection materialization determinism', () => {
  it('matches the executable normalized materialization golden', () => {
    const source = validatedSource();
    const result = validatePipelineSelections(source, {
      a: { strategy: 'single', participant: { key: 'p1', bindingKey: 'b1' } },
    });
    if (!result.ok) {
      throw new TypeError('Expected valid materialization.');
    }
    const golden: unknown = JSON.parse(
      readFileSync(new URL('../fixtures/materialization/normalized.json', import.meta.url), 'utf8'),
    );

    expect(JSON.parse(result.value.canonicalText)).toEqual(golden);
    expect(
      compilePipeline(source.source, {
        a: { strategy: 'single', participant: { key: 'p1', bindingKey: 'b1' } },
      }),
    ).toMatchObject({
      ok: true,
      sourceDigest: source.sourceDigest,
      materializationDigest: result.value.materializationDigest,
    });
  });

  it('normalizes record keys before calculating the internal digest', () => {
    const first = {
      ...sourceNodeBuilders.agent('second'),
      id: 'first',
      strategies: [
        {
          kind: 'single' as const,
          routes: { succeeded: 'second', failed: 'second', cancelled: 'second' },
        },
      ] as const,
    };
    const second = { ...sourceNodeBuilders.agent(), id: 'second' };
    const source = validatedSource(sourceWithNodes([first, second, endNode()], 'first'));
    const ordered = {
      first: { strategy: 'single' as const, participant: { key: 'first', bindingKey: 'shared' } },
      second: { strategy: 'single' as const, participant: { key: 'second', bindingKey: 'shared' } },
    };
    const reversed = {
      second: ordered.second,
      first: ordered.first,
    };
    const firstResult = validatePipelineSelections(source, ordered);
    const secondResult = validatePipelineSelections(source, reversed);
    if (!firstResult.ok || !secondResult.ok) {
      throw new TypeError('Expected valid selections.');
    }

    expect(secondResult.value.materializationDigest).toBe(firstResult.value.materializationDigest);
    expect(secondResult.value.canonicalText).toBe(firstResult.value.canonicalText);
    expect(compilePipeline(source.source, reversed)).toEqual(
      compilePipeline(source.source, ordered),
    );
  });
});
import { readFileSync } from 'node:fs';
