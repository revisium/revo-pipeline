import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import type { PipelineSourcePackage, SourceNode } from '../../../src/source/index.js';
import { materializationFor, singleSelection } from '../../support/compiler-builders.js';
import {
  childRegion,
  emptySchema,
  sourceForNode,
  sourceNodeBuilders,
} from '../../support/source-builders.js';

const callSource = (): PipelineSourcePackage => {
  const source = sourceForNode(sourceNodeBuilders.call());
  return {
    ...source,
    modules: [
      ...source.modules,
      {
        key: 'child-module',
        inputSchema: emptySchema(),
        outputSchema: emptySchema(),
        region: childRegion('child-region'),
      },
    ],
  };
};

const validMap = (): SourceNode => ({
  ...sourceNodeBuilders.map(),
  items: { kind: 'literal', value: [{ id: 'first' }] },
  itemKeyPointer: '/id',
});

const cases = [
  ['agent', sourceNodeBuilders.agent(), ['activity', 'end'], 'activity'],
  ['script', sourceNodeBuilders.script(), ['activity', 'end'], 'activity'],
  ['effect', sourceNodeBuilders.effect(), ['activity', 'end'], 'activity'],
  ['choice', sourceNodeBuilders.choice(), ['choice', 'end'], 'choice'],
  ['parallel', sourceNodeBuilders.parallel(), ['choice', 'end', 'parallel'], 'parallel'],
  ['repeat', sourceNodeBuilders.repeat(), ['end', 'repeat'], 'repeat'],
  ['map', validMap(), ['end', 'map'], 'map'],
  ['wait', sourceNodeBuilders.wait(), ['end', 'wait'], 'wait'],
  ['humanGate', sourceNodeBuilders.humanGate(), ['end', 'humanGate'], 'humanGate'],
  ['consensus', sourceNodeBuilders.consensus(), ['choice', 'end', 'parallel'], 'parallel'],
  ['call', sourceNodeBuilders.call(), ['call', 'end'], 'call'],
  ['end', sourceNodeBuilders.end(), ['end'], 'end'],
] as const;

describe('compiler source-form coverage', () => {
  for (const [kind, node, emittedKinds, entryKind] of cases) {
    it(`lowers ${kind}`, () => {
      const source = kind === 'call' ? callSource() : sourceForNode(node);
      const materialization = materializationFor(
        source,
        kind === 'agent' ? singleSelection() : undefined,
      );
      const result = compilePipeline(source, materialization);

      if (!result.ok) {
        throw new Error(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
      }
      const entryModule = result.program.modules.find(
        ({ key }) => key === result.program.entryModule,
      );
      const entryNode = entryModule?.region.nodes.find(({ id }) => id === entryModule.region.entry);
      expect(result.program.sourceDigest).toBe(result.sourceDigest);
      expect(result.program.materializationDigest).toBe(result.materializationDigest);
      expect(
        entryModule?.region.nodes.map(({ kind: programKind }) => programKind).toSorted(),
      ).toEqual(emittedKinds);
      expect(entryNode?.kind).toBe(entryKind);
      expect(entryModule?.region.entry).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(entryModule?.region.nodes)).toBe(true);
    });
  }
});
