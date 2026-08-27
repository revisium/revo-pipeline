import { describe, expect, it } from 'vitest';

import { compilePipeline, type PipelineSelections } from '../../src/index.js';
import { sourceForNode, sourceNodeBuilders } from '../support/source-builders.js';

describe('direct compiler API', () => {
  it('compiles source with public agent-slot selections', () => {
    const source = sourceForNode(sourceNodeBuilders.agent());
    const selections: PipelineSelections = {
      activity: {
        strategy: 'single',
        participant: { key: 'reviewer', bindingKey: 'reviewer-main' },
      },
    };

    expect(compilePipeline(source, selections)).toMatchObject({ ok: true });
  });
});
