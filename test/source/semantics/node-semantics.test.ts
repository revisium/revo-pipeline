import { describe, expect, it } from 'vitest';

import type { SourceNode } from '../../../src/source/index.js';
import {
  nonEmptyNodes,
  sourceForNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../../support/source-builders.js';
import { expectValidSource, sourceDiagnostics } from '../../support/source-validation.js';

describe('source node semantics', () => {
  it('proves an otherwise-null finite choice without enumerating ranges', () => {
    const complete: SourceNode = {
      ...sourceNodeBuilders.choice(),
      selector: { kind: 'literal', value: true },
      cases: [
        { key: 'false', when: { kind: 'equals', value: false }, target: 'done' },
        { key: 'true', when: { kind: 'equals', value: true }, target: 'done' },
      ],
      otherwise: null,
    };

    expectValidSource(sourceForNode(complete));
    if (complete.kind !== 'choice') {
      throw new TypeError('Expected complete choice.');
    }
    const incomplete: SourceNode = { ...complete, cases: [complete.cases[0]] };
    expect(sourceDiagnostics(sourceForNode(incomplete))).toContainEqual({
      code: 'DATA_SCHEMA_INCOMPATIBLE',
      path: '/modules/0/region/nodes/0/otherwise',
    });
  });

  it('keeps scalar choice domains type-sensitive and disjoint', () => {
    const choice = sourceNodeBuilders.choice();
    const distinct: SourceNode = {
      ...choice,
      cases: [
        { key: 'boolean', when: { kind: 'equals', value: true }, target: 'done' },
        { key: 'string', when: { kind: 'equals', value: 'true' }, target: 'done' },
      ],
    };
    expectValidSource(sourceForNode(distinct));

    const duplicate: SourceNode = {
      ...choice,
      cases: [
        { key: 'first', when: { kind: 'equals', value: true }, target: 'done' },
        { key: 'duplicate', when: { kind: 'oneOf', values: [false, true] }, target: 'done' },
      ],
    };
    expect(sourceDiagnostics(sourceForNode(duplicate))).toContainEqual({
      code: 'CANONICAL_INPUT',
      path: '/modules/0/region/nodes/0/cases',
    });
  });

  it('does not promote a oneOf-local duplicate into a cross-case diagnostic', () => {
    const localDuplicate: SourceNode = {
      ...sourceNodeBuilders.choice(),
      cases: [
        {
          key: 'only',
          when: { kind: 'oneOf', values: [true, true] },
          target: 'done',
        },
      ],
    };

    expect(sourceDiagnostics(sourceForNode(localDuplicate))).toEqual([
      {
        code: 'CANONICAL_INPUT',
        path: '/modules/0/region/nodes/0/cases/0/when/values',
      },
    ]);
  });

  it('uses one dedicated gate-bijection diagnostic', () => {
    const gate = sourceNodeBuilders.humanGate();
    const invalid: SourceNode = { ...gate, answers: ['yes', 'no'] };

    expect(sourceDiagnostics(sourceForNode(invalid))).toContainEqual({
      code: 'SOURCE_GATE_ANSWER_BIJECTION',
      path: '/modules/0/region/nodes/0',
    });
  });

  it('validates normalized gate answer identifiers at both owned fields', () => {
    const gate = sourceNodeBuilders.humanGate();
    const invalid: SourceNode = {
      ...gate,
      answers: [''],
      routes: { ...gate.routes, answers: [{ answer: '', target: 'done' }] },
    };

    expect(sourceDiagnostics(sourceForNode(invalid))).toEqual([
      { code: 'CANONICAL_INPUT', path: '/modules/0/region/nodes/0/answers/0' },
      { code: 'CANONICAL_INPUT', path: '/modules/0/region/nodes/0/routes/answers/0/answer' },
    ]);
  });

  it('caps deterministic diagnostics and appends the limit marker', () => {
    const nodes: SourceNode[] = Array.from({ length: 60 }, (_, index) => ({
      kind: 'wait',
      key: `n${String(index).padStart(3, '0')}`,
      wait: { kind: 'duration', durationMs: 1 },
      routes: { completed: 'missing', cancelled: 'missing' },
    }));
    const diagnostics = sourceDiagnostics(sourceWithNodes(nonEmptyNodes(nodes), 'n000'));

    expect(diagnostics).toHaveLength(100);
    expect(diagnostics.at(-1)).toEqual({ code: 'SOURCE_DIAGNOSTIC_LIMIT', path: '' });
    expect(new Set(diagnostics.map(({ code, path }) => `${code}:${path}`)).size).toBe(100);
  });
});
