import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import type {
  CallSourceNode,
  PipelineSourcePackage,
  SourceRegion,
} from '../../../src/source/index.js';
import { materializationFor } from '../../support/compiler-builders.js';
import {
  childRegion,
  emptySchema,
  endNode,
  sourceForNode,
  sourceNodeBuilders,
} from '../../support/source-builders.js';

type OutcomeSet = readonly [string] | readonly [string, string];

const callOutcomeRoutes = (outcomes: OutcomeSet): CallSourceNode['routes']['outcomes'] =>
  outcomes.length === 1
    ? [{ outcome: outcomes[0], target: 'done' }]
    : [
        { outcome: outcomes[0], target: 'done' },
        { outcome: outcomes[1], target: 'done' },
      ];

const childRegionForOutcomes = (outcomes: OutcomeSet): SourceRegion => {
  if (outcomes.length === 1) {
    return childRegion('child-region', outcomes[0]);
  }
  const [caseOutcome, otherwiseOutcome] = outcomes;
  return {
    key: 'child-region',
    inputSchema: emptySchema(),
    entry: 'choose',
    outputSchema: emptySchema(),
    exits: [
      { outcome: caseOutcome, outputSchema: emptySchema() },
      { outcome: otherwiseOutcome, outputSchema: emptySchema() },
    ],
    nodes: [
      {
        ...sourceNodeBuilders.choice(),
        id: 'choose',
        cases: [
          {
            key: caseOutcome,
            when: { kind: 'equals', value: true },
            target: `${caseOutcome}-end`,
          },
        ],
        otherwise: `${otherwiseOutcome}-end`,
      },
      endNode(`${caseOutcome}-end`, caseOutcome),
      endNode(`${otherwiseOutcome}-end`, otherwiseOutcome),
    ],
  };
};

const linkedSourceWithOutcomes = (
  callOutcomes: OutcomeSet,
  childOutcomes: OutcomeSet,
): PipelineSourcePackage => {
  const call = sourceNodeBuilders.call();
  const source = sourceForNode({
    ...call,
    routes: { ...call.routes, outcomes: callOutcomeRoutes(callOutcomes) },
  });
  return {
    ...source,
    modules: [
      ...source.modules,
      {
        key: 'child-module',
        inputSchema: emptySchema(),
        outputSchema: emptySchema(),
        region: childRegionForOutcomes(childOutcomes),
      },
    ],
  };
};

describe('compiler linking diagnostics', () => {
  it('reports a missing module before downstream phases', () => {
    const source = sourceForNode(sourceNodeBuilders.call());
    const result = compilePipeline(source, materializationFor(source));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          family: 'LINK',
          code: 'LINK_MODULE_MISSING',
          path: '/modules/0/region/nodes/0/module',
        },
      ],
    });
    expect(Object.keys(result).toSorted()).toEqual(['diagnostics', 'ok']);
  });

  it('rejects direct recursion', () => {
    const source = sourceForNode({ ...sourceNodeBuilders.call(), module: 'm' });
    const result = compilePipeline(source, materializationFor(source));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          family: 'LINK',
          code: 'LINK_RECURSION',
          path: '/modules/0/region/nodes/0/module',
        },
      ],
    });
  });

  it('rejects an indirect strongly connected call graph', () => {
    const module = (key: string, target: string): PipelineSourcePackage['modules'][number] => ({
      key,
      inputSchema: emptySchema(),
      outputSchema: emptySchema(),
      region: {
        ...childRegion(`${key}-region`),
        entry: `${key}-call`,
        nodes: [
          { ...sourceNodeBuilders.call(`${key}-done`), id: `${key}-call`, module: target },
          endNode(`${key}-done`),
        ],
      },
    });
    const source: PipelineSourcePackage = {
      schemaVersion: 'pipeline-source/v1',
      key: 'indirect-recursion',
      entryModule: 'a',
      maximumTotalActivities: 1,
      modules: [module('a', 'b'), module('b', 'a')],
    };
    const result = compilePipeline(source, materializationFor(source));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ family: 'LINK', code: 'LINK_RECURSION' }],
    });
    expect(Object.keys(result).toSorted()).toEqual(['diagnostics', 'ok']);
  });

  it.each([
    ['missing-only', ['ok'], ['ok', 'child-only']],
    ['extra-only', ['ok', 'call-only'], ['ok']],
    ['missing-and-extra', ['ok', 'call-only'], ['ok', 'child-only']],
  ] as const)(
    'reports one fixed outcome-set mismatch for %s',
    (_name, callOutcomes, childOutcomes) => {
      const source = linkedSourceWithOutcomes(callOutcomes, childOutcomes);
      const result = compilePipeline(source, materializationFor(source));

      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            family: 'LINK',
            code: 'LINK_MODULE_OUTCOME_MISMATCH',
            path: '/modules/1/region/nodes/0/routes/outcomes',
            message: 'The call outcome routes do not match the called module outcomes.',
          },
        ],
      });
    },
  );

  it('proves the maximum static call depth', () => {
    const modules: PipelineSourcePackage['modules'][number][] = Array.from(
      { length: 34 },
      (_, index) => {
        const key = `m${String(index).padStart(2, '0')}`;
        const next = `m${String(index + 1).padStart(2, '0')}`;
        return {
          key,
          inputSchema: emptySchema(),
          outputSchema: emptySchema(),
          region:
            index === 33
              ? childRegion(`${key}-region`)
              : {
                  ...childRegion(`${key}-region`),
                  entry: `${key}-call`,
                  nodes: [
                    {
                      ...sourceNodeBuilders.call(`${key}-done`),
                      id: `${key}-call`,
                      module: next,
                    },
                    { ...sourceNodeBuilders.end(), id: `${key}-done` },
                  ],
                },
        };
      },
    );
    const [first, ...rest] = modules;
    if (first === undefined) {
      throw new Error('Expected call-chain modules.');
    }
    const source: PipelineSourcePackage = {
      schemaVersion: 'pipeline-source/v1',
      key: 'call-depth',
      entryModule: 'm00',
      maximumTotalActivities: 1,
      modules: [first, ...rest],
    };
    const result = compilePipeline(source, materializationFor(source));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        {
          family: 'BOUND',
          code: 'BOUND_EXCEEDED',
          path: '/modules/32/region/nodes/0/module',
        },
      ],
    });
  });

  it('normalizes module, exit, and call-outcome permutations before linking', () => {
    const target = {
      key: 'child-module',
      inputSchema: emptySchema(),
      outputSchema: emptySchema(),
      region: {
        key: 'child-region',
        inputSchema: emptySchema(),
        entry: 'choose',
        outputSchema: emptySchema(),
        exits: [
          { outcome: 'zeta', outputSchema: emptySchema() },
          { outcome: 'alpha', outputSchema: emptySchema() },
        ],
        nodes: [
          {
            ...sourceNodeBuilders.choice(),
            id: 'choose',
            cases: [{ key: 'alpha', when: { kind: 'equals', value: true }, target: 'alpha-end' }],
            otherwise: 'zeta-end',
          },
          endNode('zeta-end', 'zeta'),
          endNode('alpha-end', 'alpha'),
        ],
      },
    } satisfies PipelineSourcePackage['modules'][number];
    const base = sourceForNode({
      ...sourceNodeBuilders.call(),
      routes: {
        ...sourceNodeBuilders.call().routes,
        outcomes: [
          { outcome: 'zeta', target: 'done' },
          { outcome: 'alpha', target: 'done' },
        ],
      },
    });
    const canonical: PipelineSourcePackage = { ...base, modules: [...base.modules, target] };
    const baseCall = base.modules[0].region.nodes[0];
    if (baseCall?.kind !== 'call') {
      throw new TypeError('Expected canonical call fixture.');
    }
    const permuted: PipelineSourcePackage = {
      ...canonical,
      modules: [
        {
          ...target,
          region: {
            ...target.region,
            exits: [target.region.exits[1], target.region.exits[0]],
          },
        },
        {
          ...base.modules[0],
          region: {
            ...base.modules[0].region,
            nodes: [
              {
                ...baseCall,
                routes: {
                  ...sourceNodeBuilders.call().routes,
                  outcomes: [
                    { outcome: 'alpha', target: 'done' },
                    { outcome: 'zeta', target: 'done' },
                  ],
                },
              },
              endNode(),
            ],
          },
        },
      ],
    };

    expect(compilePipeline(permuted, materializationFor(permuted))).toEqual(
      compilePipeline(canonical, materializationFor(canonical)),
    );
  });
});
