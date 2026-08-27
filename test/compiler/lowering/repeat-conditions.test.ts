import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import type { ProgramNodeId, ProgramRepeatCondition } from '../../../src/program/index.js';
import type { RepeatCondition } from '../../../src/source/index.js';
import { materializationFor } from '../../support/compiler-builders.js';
import { endNode, sourceNodeBuilders, sourceWithNodes } from '../../support/source-builders.js';

const sourceSelector = { kind: 'nodeOutput', node: 'producer', pointer: '' } as const;
const programSelector = (nodeId: ProgramNodeId) => ({
  kind: 'nodeOutput' as const,
  nodeId,
  pointer: '' as const,
});

const conditionCases: readonly {
  readonly name: string;
  readonly source: RepeatCondition;
  readonly expected: (nodeId: ProgramNodeId) => ProgramRepeatCondition;
}[] = [
  {
    name: 'equals',
    source: { kind: 'equals', selector: sourceSelector, value: true },
    expected: (nodeId) => ({ kind: 'equals', selector: programSelector(nodeId), value: true }),
  },
  {
    name: 'oneOf',
    source: { kind: 'oneOf', selector: sourceSelector, values: [true, false] },
    expected: (nodeId) => ({
      kind: 'oneOf',
      selector: programSelector(nodeId),
      values: [true, false],
    }),
  },
  {
    name: 'exists',
    source: { kind: 'exists', selector: sourceSelector },
    expected: (nodeId) => ({ kind: 'exists', selector: programSelector(nodeId) }),
  },
  {
    name: 'all',
    source: {
      kind: 'all',
      conditions: [
        { kind: 'exists', selector: sourceSelector },
        { kind: 'equals', selector: sourceSelector, value: true },
      ],
    },
    expected: (nodeId) => ({
      kind: 'all',
      conditions: [
        { kind: 'exists', selector: programSelector(nodeId) },
        { kind: 'equals', selector: programSelector(nodeId), value: true },
      ],
    }),
  },
  {
    name: 'any',
    source: {
      kind: 'any',
      conditions: [
        { kind: 'exists', selector: sourceSelector },
        { kind: 'equals', selector: sourceSelector, value: true },
      ],
    },
    expected: (nodeId) => ({
      kind: 'any',
      conditions: [
        { kind: 'exists', selector: programSelector(nodeId) },
        { kind: 'equals', selector: programSelector(nodeId), value: true },
      ],
    }),
  },
  {
    name: 'not',
    source: { kind: 'not', condition: { kind: 'exists', selector: sourceSelector } },
    expected: (nodeId) => ({
      kind: 'not',
      condition: { kind: 'exists', selector: programSelector(nodeId) },
    }),
  },
];

describe('repeat-condition compiler lowering', () => {
  it.each(conditionCases)('validates and lowers normalized $name', ({ source, expected }) => {
    const repeat = { ...sourceNodeBuilders.repeat(), id: 'repeat', continueWhen: source };
    const producer = {
      ...sourceNodeBuilders.script('repeat'),
      id: 'producer',
      outputSchema: { type: 'boolean' as const },
      routes: { succeeded: 'repeat', failed: 'done', cancelled: 'done' },
    };
    const pipeline = sourceWithNodes([producer, repeat, endNode()]);
    const result = compilePipeline(pipeline, materializationFor(pipeline));
    if (!result.ok) {
      throw new TypeError(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
    }
    const nodes = result.program.modules[0].region.nodes;
    const producerNode = nodes.find(({ kind }) => kind === 'activity');
    const repeatNode = nodes.find(({ kind }) => kind === 'repeat');
    if (producerNode?.kind !== 'activity' || repeatNode?.kind !== 'repeat') {
      throw new TypeError('Expected lowered producer and repeat nodes.');
    }

    expect(repeatNode.continueWhen).toEqual(expected(producerNode.id));
  });
});
