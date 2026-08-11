import { Compile } from 'typebox/compile';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { SourceNodeSchema, type SourceNode } from '../../../src/source/index.js';
import { allSourceNodeExamples, sourceForNode } from '../../support/source-builders.js';
import { expectValidSource } from '../../support/source-validation.js';

const nodeValidator = Compile(SourceNodeSchema);

describe('source node union', () => {
  it.each(allSourceNodeExamples().map((node) => [node.kind, node] as const))(
    'accepts the %s node and rejects undeclared fields',
    (_kind, node) => {
      expect(nodeValidator.Check(node)).toBe(true);
      expect(nodeValidator.Check({ ...node, undeclared: true })).toBe(false);
      expectTypeOf(node).toMatchTypeOf<SourceNode>();
    },
  );

  it.each(allSourceNodeExamples().map((node) => [node.kind, node] as const))(
    'validates a complete local region containing %s',
    (_kind, node) => {
      expect(expectValidSource(sourceForNode(node)).source.modules).toHaveLength(1);
    },
  );
});
