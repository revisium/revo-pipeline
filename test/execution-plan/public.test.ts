import { describe, expect, it } from 'vitest';

import { compileToExecutionPlan } from '../../src/execution-plan/public.js';
import { materializationFor, singleSelection } from '../support/compiler-builders.js';
import { sourceNodeBuilders, sourceWithNodes } from '../support/source-builders.js';

const hostInputs = {
  bindings: [],
  policies: {
    defaultTaskTimeoutMs: 60_000,
    maximumActiveNodeExecutions: 1,
    maximumNodeNestingDepth: 4,
    maximumSubpipelineDepth: 1,
    maximumTotalNodeExecutions: 4,
  },
} as const;

const choiceSource = () =>
  sourceWithNodes([
    {
      ...sourceNodeBuilders.choice('accepted'),
      key: 'select',
      selector: { kind: 'literal', value: 'yes' },
      cases: [{ key: 'yes', when: { kind: 'equals', value: 'yes' }, target: 'accepted' }],
      otherwise: 'rejected',
    },
    { ...sourceNodeBuilders.end(), key: 'accepted', outcome: 'ok' },
    { ...sourceNodeBuilders.end(), key: 'rejected', outcome: 'ok' },
  ]);

describe('execution-plan bridge', () => {
  it('compiles the documented choice/end slice into the pipeline-owned plan contract', () => {
    const source = choiceSource();

    const result = compileToExecutionPlan(source, materializationFor(source), hostInputs);

    expect(result.stage).toBe('execution-plan');
    if (result.stage !== 'execution-plan' || !result.ok) {
      throw new TypeError('Expected a lowered execution plan.');
    }
    expect(result.executionPlan.bindings).toEqual([]);
    expect(result.executionPlan.policies).toEqual(hostInputs.policies);
    expect(result.executionPlan.pipelines).toHaveProperty(result.executionPlan.rootPipelineId);
  });

  it('returns compiler failures unchanged under the compile stage', () => {
    const source = choiceSource();
    const differentSource = sourceWithNodes([{ ...sourceNodeBuilders.end() }]);

    const result = compileToExecutionPlan(source, materializationFor(differentSource), hostInputs);

    expect(result).toMatchObject({ stage: 'compile', ok: false });
    expect(result).not.toHaveProperty('executionPlan');
  });

  it('rejects a valid unsupported source form at its source provenance path', () => {
    const source = sourceWithNodes([
      { ...sourceNodeBuilders.agent(), key: 'agent' },
      { ...sourceNodeBuilders.end(), key: 'done', outcome: 'ok' },
    ]);

    const result = compileToExecutionPlan(
      source,
      materializationFor(source, singleSelection()),
      hostInputs,
    );

    expect(result).toEqual({
      stage: 'execution-plan',
      ok: false,
      diagnostics: [
        {
          family: 'EXECUTION_PLAN',
          code: 'EXECUTION_PLAN_NODE_UNSUPPORTED',
          path: '/modules/0/region/nodes/0',
          message: 'The Program node kind is not supported by this execution-plan slice.',
        },
      ],
    });
  });

  it('requires an explicit default when the compiler emits a total choice', () => {
    const withoutDefault = sourceWithNodes([
      {
        ...sourceNodeBuilders.choice('accepted'),
        key: 'select',
        selector: { kind: 'literal', value: 'yes' },
        cases: [{ key: 'yes', when: { kind: 'equals', value: 'yes' }, target: 'accepted' }],
        otherwise: null,
      },
      { ...sourceNodeBuilders.end(), key: 'accepted', outcome: 'ok' },
    ]);

    const result = compileToExecutionPlan(
      withoutDefault,
      materializationFor(withoutDefault),
      hostInputs,
    );

    expect(result).toEqual({
      stage: 'execution-plan',
      ok: false,
      diagnostics: [
        {
          family: 'EXECUTION_PLAN',
          code: 'EXECUTION_PLAN_CHOICE_DEFAULT_REQUIRED',
          path: '/modules/0/region/nodes/1',
          message: 'The execution-plan choice requires an explicit default route.',
        },
      ],
    });
  });

  it('lowers oneOf cases and module-input selectors without widening the plan contract', () => {
    const base = sourceWithNodes([
      {
        ...sourceNodeBuilders.choice('accepted'),
        key: 'select',
        selector: { kind: 'moduleInput', pointer: '' },
        cases: [
          { key: 'answers', when: { kind: 'oneOf', values: ['yes', 'no'] }, target: 'accepted' },
        ],
        otherwise: 'rejected',
      },
      { ...sourceNodeBuilders.end(), key: 'accepted', outcome: 'ok' },
      { ...sourceNodeBuilders.end(), key: 'rejected', outcome: 'ok' },
    ]);
    const source = structuredClone(base);
    const module = source.modules[0];
    if (module === undefined) {
      throw new TypeError('Expected one module.');
    }
    Object.defineProperty(module, 'inputSchema', { value: { type: 'string' } });
    Object.defineProperty(module.region, 'inputSchema', { value: { type: 'string' } });

    const result = compileToExecutionPlan(source, materializationFor(source), hostInputs);

    expect(result.stage).toBe('execution-plan');
    if (result.stage !== 'execution-plan' || !result.ok) {
      throw new TypeError('Expected a lowered execution plan.');
    }
    const root = result.executionPlan.pipelines[result.executionPlan.rootPipelineId]?.root;
    expect(root).toMatchObject({
      kind: 'choice',
      selector: { kind: 'pipelineInput', pointer: '' },
      cases: { no: { kind: 'end' }, yes: { kind: 'end' } },
    });
  });

  it('rejects shared choice targets instead of lowering a graph as a tree', () => {
    const source = sourceWithNodes([
      {
        ...sourceNodeBuilders.choice('done'),
        key: 'select',
        selector: { kind: 'literal', value: 'yes' },
        cases: [{ key: 'yes', when: { kind: 'equals', value: 'yes' }, target: 'done' }],
        otherwise: 'done',
      },
      { ...sourceNodeBuilders.end(), key: 'done', outcome: 'ok' },
    ]);

    const result = compileToExecutionPlan(source, materializationFor(source), hostInputs);

    expect(result).toMatchObject({
      stage: 'execution-plan',
      ok: false,
      diagnostics: [
        {
          family: 'EXECUTION_PLAN',
          code: 'EXECUTION_PLAN_GRAPH_UNSUPPORTED',
        },
      ],
    });
  });

  it('rejects nonempty bindings and invalid policy values supplied at the runtime boundary', () => {
    const source = choiceSource();
    const invalidInputs = structuredClone(hostInputs);
    Object.defineProperty(invalidInputs, 'bindings', { value: ['unbound'] });
    Object.defineProperty(invalidInputs.policies, 'maximumNodeNestingDepth', { value: 0 });

    const result = compileToExecutionPlan(source, materializationFor(source), invalidInputs);

    expect(result).toMatchObject({
      stage: 'execution-plan',
      ok: false,
      diagnostics: [
        { code: 'EXECUTION_PLAN_BINDINGS_UNSUPPORTED', path: '' },
        { code: 'EXECUTION_PLAN_CONTRACT_INVALID', path: '' },
      ],
    });
  });
});
