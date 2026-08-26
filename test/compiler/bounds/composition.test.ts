import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import type { PipelineSourcePackage, SourceNode, SourceRegion } from '../../../src/source/index.js';
import {
  consensusSelection,
  materializationFor,
  singleSelection,
} from '../../support/compiler-builders.js';
import {
  emptySchema,
  endNode,
  nonEmptyNodes,
  sourceForNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../../support/source-builders.js';

const activityRegion = (key: string, outcome: string): SourceRegion => ({
  key,
  inputSchema: emptySchema(),
  entry: `${key}-activity`,
  outputSchema: emptySchema(),
  exits: [{ outcome, outputSchema: emptySchema() }],
  nodes: [
    {
      ...sourceNodeBuilders.script(`${key}-done`),
      id: `${key}-activity`,
      requirementKey: `${key}-requirement`,
      script: { id: `script:${key}-script`, version: 1 },
    },
    endNode(`${key}-done`, outcome),
  ],
});

const boundedSource = (node: SourceNode): PipelineSourcePackage => ({
  ...sourceForNode(node),
  maximumTotalActivities: 1,
});

const nestedRepeatRegion = (depth: number): SourceRegion => {
  if (depth === 0) {
    return activityRegion('leaf', 'value');
  }
  const body = nestedRepeatRegion(depth - 1);
  return {
    key: `repeat-region-${depth}`,
    inputSchema: emptySchema(),
    entry: `repeat-${depth}`,
    outputSchema: emptySchema(),
    exits: [{ outcome: 'value', outputSchema: emptySchema() }],
    nodes: [
      {
        kind: 'repeat',
        id: `repeat-${depth}`,
        maximumIterations: 100,
        initialInput: {},
        nextInput: {},
        body,
        bodyExits: [{ outcome: 'value', classification: 'value' }],
        continueWhen: { kind: 'exists', selector: { kind: 'literal', value: true } },
        output: {},
        outputSchema: emptySchema(),
        routes: {
          completed: `repeat-${depth}-done`,
          exhausted: `repeat-${depth}-done`,
          failed: `repeat-${depth}-done`,
          cancelled: `repeat-${depth}-done`,
        },
      },
      endNode(`repeat-${depth}-done`, 'value'),
    ],
  };
};

const overflowingForms = (): readonly { readonly name: string; readonly node: SourceNode }[] => [
  {
    name: 'parallel branch sum',
    node: {
      ...sourceNodeBuilders.parallel(),
      branches: [
        {
          key: 'left',
          input: {},
          region: activityRegion('left', 'ok'),
          exits: [{ outcome: 'ok', classification: 'qualifies' }],
        },
        {
          key: 'right',
          input: {},
          region: activityRegion('right', 'ok'),
          exits: [{ outcome: 'ok', classification: 'qualifies' }],
        },
      ],
    },
  },
  {
    name: 'repeat multiplier',
    node: {
      ...sourceNodeBuilders.repeat(),
      body: activityRegion('repeat-body', 'value'),
    },
  },
  {
    name: 'map multiplier',
    node: {
      ...sourceNodeBuilders.map(),
      items: { kind: 'literal', value: [{ id: 'first' }, { id: 'second' }] },
      itemKeyPointer: '/id',
      body: activityRegion('map-body', 'completed'),
    },
  },
  {
    name: 'explicit consensus participants',
    node: sourceNodeBuilders.consensus(),
  },
];

const strategyBranchSource = (branch: SourceNode): PipelineSourcePackage => {
  const agent = sourceNodeBuilders.agent('done');
  return {
    ...sourceWithNodes(
      [
        {
          ...agent,
          strategies: [
            ...agent.strategies,
            {
              kind: 'consensus',
              minimumParticipants: 2,
              maximumParticipants: 2,
              policy: { kind: 'unanimous' },
              remaining: 'drain',
              routes: {
                approved: branch.id,
                rejected: branch.id,
                inconclusive: branch.id,
                participantFailed: branch.id,
                cancelled: branch.id,
              },
            },
          ],
        },
        branch,
        endNode(),
        endNode('branch-end'),
      ],
      agent.id,
    ),
    maximumTotalActivities: 1_000_000,
  };
};

const overflowingStrategyBranch = (): SourceNode => ({
  ...sourceNodeBuilders.repeat('branch-end'),
  id: 'branch',
  maximumIterations: 100,
  body: nestedRepeatRegion(8),
});

describe('composed activity bounds', () => {
  for (const testCase of overflowingForms()) {
    it(`counts ${testCase.name}`, () => {
      const source = boundedSource(testCase.node);
      const result = compilePipeline(source, materializationFor(source));

      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            family: 'BOUND',
            code: 'BOUND_EXCEEDED',
            path: '/maximumTotalActivities',
            message: 'A declared pipeline bound was exceeded.',
          },
        ],
      });
    });
  }

  it.each(overflowingForms())('accepts $name at its exact composed bound', ({ node }) => {
    const source = { ...boundedSource(node), maximumTotalActivities: 2 };

    expect(compilePipeline(source, materializationFor(source))).toMatchObject({ ok: true });
  });

  it('distinguishes arithmetic overflow from a declared-limit excess', () => {
    const source: PipelineSourcePackage = {
      schemaVersion: 'pipeline-source/v1',
      key: 'overflow',
      entryModule: 'main',
      maximumTotalActivities: 1_000_000,
      modules: [
        {
          key: 'main',
          inputSchema: emptySchema(),
          outputSchema: emptySchema(),
          region: nestedRepeatRegion(8),
        },
      ],
    };
    const result = compilePipeline(source, materializationFor(source));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ family: 'BOUND', code: 'BOUND_OVERFLOW' }],
    });
  });

  it('ignores overflow on a branch unreachable under the selected strategy', () => {
    const source = strategyBranchSource(overflowingStrategyBranch());

    expect(compilePipeline(source, materializationFor(source, singleSelection()))).toMatchObject({
      ok: true,
    });
  });

  it('does not count an ordinary activity unreachable under the selected strategy', () => {
    const source = {
      ...strategyBranchSource({ ...sourceNodeBuilders.script('branch-end'), id: 'branch' }),
      maximumTotalActivities: 1,
    };

    expect(compilePipeline(source, materializationFor(source, singleSelection()))).toMatchObject({
      ok: true,
    });
  });

  it('still rejects overflow reachable under the selected strategy', () => {
    const source = strategyBranchSource(overflowingStrategyBranch());
    const result = compilePipeline(source, materializationFor(source, consensusSelection()));

    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? [] : result.diagnostics.map(({ code }) => code)).toContain('BOUND_OVERFLOW');
  });

  const callComposition = (withContinuation: boolean): PipelineSourcePackage => {
    const call = {
      ...sourceNodeBuilders.call(),
      routes: {
        outcomes: [{ outcome: 'ok', target: withContinuation ? 'continue' : 'done' }],
        failed: 'done',
        cancelled: 'done',
      },
    } satisfies SourceNode;
    const caller = withContinuation
      ? sourceWithNodes([
          call,
          {
            ...sourceNodeBuilders.script(),
            id: 'continue',
            requirementKey: 'continuation',
            script: { id: 'script:continuation', version: 1 },
          },
          endNode(),
        ])
      : sourceForNode(call);
    return {
      ...caller,
      modules: [
        ...caller.modules,
        {
          key: 'child-module',
          inputSchema: emptySchema(),
          outputSchema: emptySchema(),
          region: activityRegion('called-region', 'ok'),
        },
      ],
    };
  };

  it.each([
    ['call target activity', callComposition(false), 1],
    ['call target plus caller continuation', callComposition(true), 2],
  ] as const)('counts %s at its exact declared maximum', (_name, base, maximum) => {
    const accepted = { ...base, maximumTotalActivities: maximum };

    expect(compilePipeline(accepted, materializationFor(accepted))).toMatchObject({ ok: true });
  });

  it('rejects call plus continuation above the declared maximum', () => {
    const source = { ...callComposition(true), maximumTotalActivities: 1 };
    expect(compilePipeline(source, materializationFor(source))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'BOUND_EXCEEDED', path: '/maximumTotalActivities' }],
    });
  });

  it('counts materialized slot-consensus participants', () => {
    const agent = sourceNodeBuilders.agent();
    const source: PipelineSourcePackage = {
      ...sourceForNode({
        ...agent,
        strategies: [
          ...agent.strategies,
          {
            kind: 'consensus',
            minimumParticipants: 2,
            maximumParticipants: 2,
            policy: { kind: 'unanimous' },
            remaining: 'drain',
            routes: {
              approved: 'done',
              rejected: 'done',
              inconclusive: 'done',
              participantFailed: 'done',
              cancelled: 'done',
            },
          },
        ],
      }),
      maximumTotalActivities: 1,
    };
    const materialization = materializationFor(source, consensusSelection());

    expect(compilePipeline(source, materialization)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'BOUND_EXCEEDED', path: '/maximumTotalActivities' }],
    });
    expect(
      compilePipeline(
        { ...source, maximumTotalActivities: 2 },
        materializationFor({ ...source, maximumTotalActivities: 2 }, consensusSelection()),
      ),
    ).toMatchObject({ ok: true });
  });

  it('memoizes a shared tail once per exclusive route', () => {
    const source: PipelineSourcePackage = {
      ...sourceWithNodes(
        [
          {
            ...sourceNodeBuilders.choice('tail'),
            id: 'choose',
            otherwise: 'tail',
          },
          { ...sourceNodeBuilders.script(), id: 'tail' },
          endNode(),
        ],
        'choose',
      ),
      maximumTotalActivities: 1,
    };

    expect(compilePipeline(source, materializationFor(source))).toMatchObject({ ok: true });
  });

  it('returns a closed result for an exact 4096-node linear control-flow graph', () => {
    const waits = Array.from({ length: 4095 }, (_, index) => ({
      ...sourceNodeBuilders.wait(`n${index + 1}`),
      id: `n${index}`,
    })) satisfies SourceNode[];
    const source = sourceWithNodes(nonEmptyNodes([...waits, endNode('n4095')]), 'n0');

    const result = compilePipeline(source, materializationFor(source));

    expect(result).toMatchObject({ ok: true });
    expect(result.ok ? result.program.modules[0]?.region.nodes : null).toHaveLength(4096);
  });
});
