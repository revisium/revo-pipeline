import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import type { ProgramNode, ProgramRegion } from '../../../src/program/index.js';
import type { PipelineSourcePackage } from '../../../src/source/index.js';
import { materializationFor } from '../../support/compiler-builders.js';
import {
  childRegion,
  emptySchema,
  sourceForNode,
  sourceNodeBuilders,
} from '../../support/source-builders.js';

const entryNodeFor = (
  source: PipelineSourcePackage,
): { readonly node: ProgramNode; readonly region: ProgramRegion } => {
  const result = compilePipeline(source, materializationFor(source));
  if (!result.ok) {
    throw new TypeError(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
  }
  const module = result.program.modules.find(({ key }) => key === result.program.entryModule);
  const node = module?.region.nodes.find(({ id }) => id === module.region.entry);
  if (module === undefined || node === undefined) {
    throw new TypeError('Expected an entry module and node.');
  }
  return { node, region: module.region };
};

const continuationId = (region: ProgramRegion): string => {
  const continuation = region.nodes.find(({ kind }) => kind === 'end');
  if (continuation === undefined) {
    throw new TypeError('Expected a continuation end node.');
  }
  return continuation.id;
};

describe('direct and structured node lowering contracts', () => {
  it('emits the exact repeat contract and child region', () => {
    const { node, region } = entryNodeFor(sourceForNode(sourceNodeBuilders.repeat()));
    if (node.kind !== 'repeat') {
      throw new TypeError('Expected repeat entry.');
    }
    const bodyEnd = node.body.nodes[0];
    const target = continuationId(region);

    expect(node).toEqual({
      kind: 'repeat',
      id: node.id,
      maximumIterations: 2,
      initialInput: {},
      nextInput: {},
      body: {
        id: node.body.id,
        inputSchema: emptySchema(),
        entry: bodyEnd.id,
        outputSchema: emptySchema(),
        exits: [{ outcome: 'value', outputSchema: emptySchema() }],
        nodes: [{ kind: 'end', id: bodyEnd.id, outcome: 'value', output: {} }],
      },
      bodyExits: [{ outcome: 'value', classification: 'value' }],
      continueWhen: {
        kind: 'exists',
        selector: { kind: 'repeat', value: 'iteration', pointer: '' },
      },
      output: {},
      outputSchema: emptySchema(),
      routes: { completed: target, exhausted: target, failed: target, cancelled: target },
    });
  });

  it('emits the exact map contract and child region', () => {
    const sourceNode = {
      ...sourceNodeBuilders.map(),
      items: { kind: 'literal' as const, value: [{ id: 'first' }] },
      itemKeyPointer: '/id' as const,
    };
    const { node, region } = entryNodeFor(sourceForNode(sourceNode));
    if (node.kind !== 'map') {
      throw new TypeError('Expected map entry.');
    }
    const bodyEnd = node.body.nodes[0];
    const target = continuationId(region);

    expect(node).toEqual({
      kind: 'map',
      id: node.id,
      items: { kind: 'literal', value: [{ id: 'first' }] },
      itemKeyPointer: '/id',
      maximumItems: 2,
      maximumConcurrency: 1,
      bodyInput: {},
      body: {
        id: node.body.id,
        inputSchema: emptySchema(),
        entry: bodyEnd.id,
        outputSchema: emptySchema(),
        exits: [{ outcome: 'completed', outputSchema: emptySchema() }],
        nodes: [{ kind: 'end', id: bodyEnd.id, outcome: 'completed', output: {} }],
      },
      bodyExits: [{ outcome: 'completed', classification: 'completed' }],
      failure: { kind: 'collect' },
      routes: { completed: target, failed: target, cancelled: target },
    });
  });

  it('emits the exact wait contract', () => {
    const { node, region } = entryNodeFor(sourceForNode(sourceNodeBuilders.wait()));
    if (node.kind !== 'wait') {
      throw new TypeError('Expected wait entry.');
    }
    const target = continuationId(region);

    expect(node).toEqual({
      kind: 'wait',
      id: node.id,
      wait: { kind: 'duration', durationMs: 1 },
      routes: { completed: target, cancelled: target },
    });
  });

  it('emits the exact human-gate contract', () => {
    const { node, region } = entryNodeFor(sourceForNode(sourceNodeBuilders.humanGate()));
    if (node.kind !== 'humanGate') {
      throw new TypeError('Expected human-gate entry.');
    }
    const target = continuationId(region);

    expect(node).toEqual({
      kind: 'humanGate',
      id: node.id,
      subject: 'Approve?',
      answers: ['yes'],
      authorizationRequirements: [],
      payloadSchema: null,
      deadline: null,
      routes: {
        answers: [{ answer: 'yes', target }],
        cancelled: target,
      },
    });
  });

  it('emits the exact call contract against the linked module', () => {
    const source = sourceForNode(sourceNodeBuilders.call());
    const linkedSource: PipelineSourcePackage = {
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
    const { node, region } = entryNodeFor(linkedSource);
    if (node.kind !== 'call') {
      throw new TypeError('Expected call entry.');
    }
    const target = continuationId(region);

    expect(node).toEqual({
      kind: 'call',
      id: node.id,
      module: 'child-module',
      input: {},
      outputSchema: emptySchema(),
      routes: {
        outcomes: [{ outcome: 'ok', target }],
        failed: target,
        cancelled: target,
      },
    });
  });
});
