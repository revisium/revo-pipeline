import { describe, expect, it } from 'vitest';

import { compileToExecutionPlan } from '../../src/revo-run/public.js';
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

describe('revo-run execution-plan bridge', () => {
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
});
