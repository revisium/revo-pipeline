import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import type {
  AgentSourceNode,
  PipelineSourcePackage,
  ScriptSourceNode,
  ValueSchema,
} from '../../../src/source/index.js';
import {
  consensusSelection,
  materializationFor,
  singleSelection,
} from '../../support/compiler-builders.js';
import { endNode, sourceNodeBuilders, sourceWithNodes } from '../../support/source-builders.js';

const fieldSchema = (value: ValueSchema): ValueSchema => ({
  type: 'object',
  properties: { value },
  required: ['value'],
  additionalProperties: false,
});

const strategyReachabilitySource = (): PipelineSourcePackage => {
  const baseAgent = sourceNodeBuilders.agent();
  const agent: AgentSourceNode = {
    ...baseAgent,
    strategies: [
      {
        ...baseAgent.strategies[0],
        routes: { succeeded: 'done', failed: 'done', cancelled: 'done' },
      },
      {
        kind: 'consensus',
        minimumParticipants: 2,
        maximumParticipants: 2,
        policy: { kind: 'unanimous' },
        remaining: 'drain',
        routes: {
          approved: 'invalid',
          rejected: 'invalid',
          inconclusive: 'invalid',
          participantFailed: 'invalid',
          cancelled: 'invalid',
        },
      },
    ],
  };
  const invalid: ScriptSourceNode = {
    ...sourceNodeBuilders.script('branch-end'),
    key: 'invalid',
    input: { value: { kind: 'literal', value: true } },
    inputSchema: fieldSchema({ type: 'string' }),
  };
  return sourceWithNodes([agent, invalid, endNode(), endNode('branch-end')]);
};

const diagnostics = (source: PipelineSourcePackage, consensus: boolean) => {
  const selection = consensus ? consensusSelection() : singleSelection();
  const result = compilePipeline(source, materializationFor(source, selection));
  return result.ok ? [] : result.diagnostics.map(({ code, path }) => ({ code, path }));
};

describe('selected-strategy dataflow reachability', () => {
  it('ignores invalid dataflow in a node dead under the selected strategy', () => {
    const source = strategyReachabilitySource();

    expect(compilePipeline(source, materializationFor(source, singleSelection()))).toMatchObject({
      ok: true,
    });
  });

  it('preserves the exact diagnostic when the invalid node is strategy-reachable', () => {
    const source = strategyReachabilitySource();

    expect(diagnostics(source, true)).toEqual([
      {
        code: 'DATA_SCHEMA_INCOMPATIBLE',
        path: '/modules/0/region/nodes/3/input/value',
      },
    ]);
  });
});
