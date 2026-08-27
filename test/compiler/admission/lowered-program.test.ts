import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import type { ConsensusSourceNode, SourceNode } from '../../../src/source/index.js';
import { materializationFor } from '../../support/compiler-builders.js';
import {
  endNode,
  nonEmptyNodes,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../../support/source-builders.js';

const consensusNode = (index: number, target: string): ConsensusSourceNode => ({
  ...sourceNodeBuilders.consensus(target),
  id: `c${String(index).padStart(3, '0')}`,
});

const expandedConsensusSource = (count: number) => {
  const nodes: SourceNode[] = Array.from({ length: count }, (_, index) =>
    consensusNode(index, index + 1 === count ? 'done' : `c${String(index + 1).padStart(3, '0')}`),
  );
  nodes.push(endNode());
  return {
    ...sourceWithNodes(nonEmptyNodes(nodes), 'c000'),
    maximumTotalActivities: count * 2,
  };
};

describe('lowered Program admission', () => {
  it('rejects the first source node whose lowering crosses the Program node cap', () => {
    const source = expandedConsensusSource(410);
    const result = compilePipeline(source, materializationFor(source));

    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          family: 'BOUND',
          code: 'BOUND_EXCEEDED',
          path: '/modules/0/region/nodes/409',
          message: 'A declared pipeline bound was exceeded.',
        },
      ],
    });
    expect(result).not.toHaveProperty('program');
    expect(result).not.toHaveProperty('programDigest');
  });
});
