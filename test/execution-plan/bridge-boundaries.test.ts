import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../src/index.js';
import type { ProgramValueMapping, ProgramValueSelector } from '../../src/program/index.js';
import { materializationFor } from '../support/compiler-builders.js';
import {
  choiceIdentity,
  executionPlanDiagnostic,
  finalizeExecutionPlanDiagnostics,
  lowerExecutionOutput,
  lowerExecutionSelector,
  lowerToExecutionPlan,
  pipelineIdentity,
} from '../support/execution-plan-internal.js';
import { sourceNodeBuilders, sourceWithNodes } from '../support/source-builders.js';

const digest = `sha256:${'a'.repeat(64)}`;
const hostOptions = {
  bindings: [],
  policies: {
    defaultTaskTimeoutMs: 60_000,
    maximumActiveNodeExecutions: 1,
    maximumNodeNestingDepth: 1,
    maximumSubpipelineDepth: 1,
    maximumTotalNodeExecutions: 4,
  },
} as const;

const supportedChoiceSource = () =>
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

const compiledBundle = (source: ReturnType<typeof supportedChoiceSource>) => {
  const compiled = compilePipeline(source, materializationFor(source));
  if (!compiled.ok) {
    throw new TypeError(`Expected compilation to succeed: ${JSON.stringify(compiled.diagnostics)}`);
  }
  return structuredClone({
    program: compiled.program,
    requirements: compiled.requirements,
    provenance: compiled.provenance,
  });
};

describe('execution-plan bridge boundaries', () => {
  it('converts only literal and module-input selectors into plan values', () => {
    const literal = { kind: 'literal', value: 'ready' } satisfies ProgramValueSelector;
    const moduleInput = { kind: 'moduleInput', pointer: '/answer' } satisfies ProgramValueSelector;
    const scopeInput = { kind: 'scopeInput', pointer: '/answer' } satisfies ProgramValueSelector;

    expect(lowerExecutionSelector(literal)).toEqual({ kind: 'literal', value: 'ready' });
    expect(lowerExecutionSelector(moduleInput)).toEqual({
      kind: 'pipelineInput',
      pointer: '/answer',
    });
    expect(lowerExecutionSelector(scopeInput)).toBeNull();
  });

  it('sorts supported output mappings and rejects invalid output keys', () => {
    const output = {
      z: { kind: 'literal', value: 'last' },
      a: { kind: 'moduleInput', pointer: '' },
    } satisfies ProgramValueMapping;
    const invalidKey = {
      '': { kind: 'literal', value: 'nope' },
    } satisfies ProgramValueMapping;

    expect(lowerExecutionOutput(output)).toEqual({
      a: { kind: 'pipelineInput', pointer: '' },
      z: { kind: 'literal', value: 'last' },
    });
    expect(lowerExecutionOutput(invalidKey)).toBeNull();
  });

  it('derives stable plan identities only from exact digests', () => {
    expect(pipelineIdentity(digest)).toBe(`pipeline_${'a'.repeat(64)}`);
    expect(choiceIdentity(digest)).toBe(`choice_${'a'.repeat(64)}`);
    expect(pipelineIdentity('not-a-digest')).toBeNull();
    expect(choiceIdentity('sha256:short')).toBeNull();
  });

  it('deduplicates and sorts bridge diagnostics by source path then code', () => {
    const later = executionPlanDiagnostic('EXECUTION_PLAN_SELECTOR_UNSUPPORTED', '/z');
    const first = executionPlanDiagnostic('EXECUTION_PLAN_NODE_UNSUPPORTED', '/a');
    const secondAtFirstPath = executionPlanDiagnostic('EXECUTION_PLAN_GRAPH_UNSUPPORTED', '/a');

    expect(finalizeExecutionPlanDiagnostics([later, first, later, secondAtFirstPath])).toEqual([
      secondAtFirstPath,
      first,
      later,
    ]);
  });

  it('keeps the supplied nesting policy verbatim instead of treating it as a compiler bound', () => {
    const source = sourceWithNodes([
      {
        ...sourceNodeBuilders.choice('second'),
        key: 'first',
        selector: { kind: 'literal', value: 'first' },
        cases: [{ key: 'next', when: { kind: 'equals', value: 'first' }, target: 'second' }],
        otherwise: 'first-fallback',
      },
      {
        ...sourceNodeBuilders.choice('accepted'),
        key: 'second',
        selector: { kind: 'literal', value: 'second' },
        cases: [{ key: 'next', when: { kind: 'equals', value: 'second' }, target: 'accepted' }],
        otherwise: 'second-fallback',
      },
      { ...sourceNodeBuilders.end(), key: 'accepted', outcome: 'ok' },
      { ...sourceNodeBuilders.end(), key: 'first-fallback', outcome: 'ok' },
      { ...sourceNodeBuilders.end(), key: 'second-fallback', outcome: 'ok' },
    ]);

    const result = lowerToExecutionPlan(compiledBundle(source), hostOptions);

    expect(result).toMatchObject({
      ok: true,
      executionPlan: { policies: { maximumNodeNestingDepth: 1 } },
    });
  });

  it('rejects a Program without a stable root identity', () => {
    const bundle = compiledBundle(supportedChoiceSource());
    const module = bundle.program.modules[0];
    if (module === undefined) {
      throw new TypeError('Expected one module.');
    }
    Object.defineProperty(module.region, 'id', { value: 'not-a-digest' });

    expect(lowerToExecutionPlan(bundle, hostOptions)).toEqual({
      ok: false,
      diagnostics: [
        {
          family: 'EXECUTION_PLAN',
          code: 'EXECUTION_PLAN_IDENTITY_INVALID',
          path: '',
          message: 'A Program identity cannot be converted to a stable run identifier.',
        },
      ],
    });
  });

  it('rejects Program bundles with more than one module', () => {
    const bundle = compiledBundle(supportedChoiceSource());
    Object.defineProperty(bundle.program, 'modules', {
      value: [...bundle.program.modules, ...bundle.program.modules],
    });

    expect(lowerToExecutionPlan(bundle, hostOptions)).toEqual({
      ok: false,
      diagnostics: [
        {
          family: 'EXECUTION_PLAN',
          code: 'EXECUTION_PLAN_MODULES_UNSUPPORTED',
          path: '',
          message: 'The execution-plan slice supports exactly one Program module.',
        },
      ],
    });
  });

  it('rejects unsupported Program outcomes at their provenance path', () => {
    const source = sourceWithNodes([{ ...sourceNodeBuilders.end(), key: 'done', outcome: 'ok' }]);
    const bundle = compiledBundle(source);
    const end = bundle.program.modules[0]?.region.nodes.find((node) => node.kind === 'end');
    if (end === undefined || end.kind !== 'end') {
      throw new TypeError('Expected one Program end node.');
    }
    Object.defineProperty(end, 'outcome', { value: '' });

    expect(lowerToExecutionPlan(bundle, hostOptions)).toEqual({
      ok: false,
      diagnostics: [
        {
          family: 'EXECUTION_PLAN',
          code: 'EXECUTION_PLAN_OUTCOME_UNSUPPORTED',
          path: '/modules/0/region/nodes/0',
          message: 'The Program outcome is not a supported run identifier.',
        },
      ],
    });
  });

  it('rejects non-identifier end-output keys at their provenance path', () => {
    const source = sourceWithNodes([{ ...sourceNodeBuilders.end(), key: 'done', outcome: 'ok' }]);
    const bundle = compiledBundle(source);
    const end = bundle.program.modules[0]?.region.nodes.find((node) => node.kind === 'end');
    if (end === undefined || end.kind !== 'end') {
      throw new TypeError('Expected one Program end node.');
    }
    Object.defineProperty(end, 'output', { value: { '': { kind: 'literal', value: 'nope' } } });

    expect(lowerToExecutionPlan(bundle, hostOptions)).toEqual({
      ok: false,
      diagnostics: [
        {
          family: 'EXECUTION_PLAN',
          code: 'EXECUTION_PLAN_OUTPUT_KEY_UNSUPPORTED',
          path: '/modules/0/region/nodes/0',
          message: 'The Program output key is not a supported run identifier.',
        },
      ],
    });
  });

  it('rejects non-string choice values at their provenance path', () => {
    const source = sourceWithNodes([
      {
        ...sourceNodeBuilders.choice('accepted'),
        key: 'select',
        selector: { kind: 'literal', value: true },
        cases: [{ key: 'yes', when: { kind: 'equals', value: true }, target: 'accepted' }],
        otherwise: 'rejected',
      },
      { ...sourceNodeBuilders.end(), key: 'accepted', outcome: 'ok' },
      { ...sourceNodeBuilders.end(), key: 'rejected', outcome: 'ok' },
    ]);

    expect(lowerToExecutionPlan(compiledBundle(source), hostOptions)).toEqual({
      ok: false,
      diagnostics: [
        {
          family: 'EXECUTION_PLAN',
          code: 'EXECUTION_PLAN_CHOICE_VALUE_UNSUPPORTED',
          path: '/modules/0/region/nodes/2',
          message: 'The execution-plan choice value is not a supported run identifier.',
        },
      ],
    });
  });

  it('rejects a structurally over-deep choice tree at the internal safe bound', () => {
    const bundle = compiledBundle(supportedChoiceSource());
    const choice = bundle.program.modules[0]?.region.nodes.find((node) => node.kind === 'choice');
    const end = bundle.program.modules[0]?.region.nodes.find((node) => node.kind === 'end');
    if (
      choice === undefined ||
      choice.kind !== 'choice' ||
      end === undefined ||
      end.kind !== 'end'
    ) {
      throw new TypeError('Expected Program choice and end templates.');
    }
    const nodeId = (ordinal: number) => `sha256:${ordinal.toString(16).padStart(64, '0')}`;
    const choices = Array.from({ length: 33 }, (_, index) => ({
      ...choice,
      id: nodeId(index + 1),
      cases: [
        {
          ...choice.cases[0],
          target: index === 32 ? nodeId(200) : nodeId(index + 2),
        },
      ],
      otherwise: nodeId(index + 100),
    }));
    const ends = [
      { ...end, id: nodeId(200) },
      ...Array.from({ length: 33 }, (_, index) => ({ ...end, id: nodeId(index + 100) })),
    ];
    const module = bundle.program.modules[0];
    if (module === undefined) {
      throw new TypeError('Expected one Program module.');
    }
    Object.defineProperty(module.region, 'entry', { value: choices[0]?.id });
    Object.defineProperty(module.region, 'nodes', { value: [...choices, ...ends] });
    Object.defineProperty(bundle.provenance, 'nodes', {
      value: choices.map((node, index) => ({
        programNodeId: node.id,
        sourcePath: `/depth/${index}`,
      })),
    });

    expect(lowerToExecutionPlan(bundle, hostOptions)).toEqual({
      ok: false,
      diagnostics: [
        {
          family: 'EXECUTION_PLAN',
          code: 'EXECUTION_PLAN_DEPTH_EXCEEDED',
          path: '/depth/32',
          message: 'The lowered execution plan exceeds the configured node nesting depth.',
        },
      ],
    });
  });
});
