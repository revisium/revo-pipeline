import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PIPELINE_DIAGNOSTIC_CATALOG, appendJsonPointer } from '../../src/foundation/index.js';
import { compilePipeline } from '../../src/index.js';
import { validatePipelineSelections } from '../../src/materialization/index.js';
import { validatePipelineSource } from '../../src/source/index.js';
import { consensusAgentNode } from '../support/compiler-builders.js';
import {
  endNode,
  nonEmptyNodes,
  sourceForNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../support/source-builders.js';

const validated = (source = sourceForNode(sourceNodeBuilders.agent())) => {
  const result = validatePipelineSource(source);
  if (!result.ok) {
    throw new TypeError('Expected a valid source fixture.');
  }
  return result.value;
};

const diagnostic = (code: keyof typeof PIPELINE_DIAGNOSTIC_CATALOG, path: string) => ({
  family: 'MATERIALIZATION',
  code,
  path,
  message: PIPELINE_DIAGNOSTIC_CATALOG[code].message,
});

type DiagnosticGolden = { readonly name: string } & ReturnType<typeof diagnostic>;

const isDiagnosticGolden = (value: unknown): value is DiagnosticGolden => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    typeof Reflect.get(value, 'name') === 'string' &&
    Reflect.get(value, 'family') === 'MATERIALIZATION' &&
    typeof Reflect.get(value, 'code') === 'string' &&
    typeof Reflect.get(value, 'path') === 'string' &&
    typeof Reflect.get(value, 'message') === 'string'
  );
};

const diagnosticGoldenInput: unknown = JSON.parse(
  readFileSync(
    new URL('../fixtures/materialization/selection-diagnostics.json', import.meta.url),
    'utf8',
  ),
);
if (!Array.isArray(diagnosticGoldenInput) || !diagnosticGoldenInput.every(isDiagnosticGolden)) {
  throw new TypeError('Expected a valid selection diagnostic golden.');
}
const diagnosticGolden: readonly DiagnosticGolden[] = diagnosticGoldenInput;

const goldenDiagnostic = (name: string) => {
  const value = diagnosticGolden.find((entry) => entry.name === name);
  if (value === undefined) {
    throw new TypeError(`Missing selection diagnostic golden: ${name}`);
  }
  const { name: _name, ...diagnosticValue } = value;
  return diagnosticValue;
};

describe('pipeline selection diagnostics', () => {
  it('uses node IDs for missing, extra, unavailable, duplicate-participant, and policy paths', () => {
    const agent = validated();
    const consensus = validated(sourceForNode(consensusAgentNode()));

    expect(validatePipelineSelections(agent, {})).toEqual({
      ok: false,
      diagnostics: [goldenDiagnostic('missing')],
    });
    expect(
      validatePipelineSelections(agent, {
        other: { strategy: 'single', participant: { key: 'x', bindingKey: 'x-binding' } },
      }),
    ).toEqual({
      ok: false,
      diagnostics: [goldenDiagnostic('missing'), { ...goldenDiagnostic('extra'), path: '/other' }],
    });
    expect(
      validatePipelineSelections(agent, {
        activity: { strategy: 'consensus', participants: [{ key: 'x', bindingKey: 'x-binding' }] },
      }),
    ).toEqual({
      ok: false,
      diagnostics: [goldenDiagnostic('unavailable strategy')],
    });
    expect(
      validatePipelineSelections(consensus, {
        activity: {
          strategy: 'consensus',
          participants: [
            { key: 'x', bindingKey: 'x-binding' },
            { key: 'x', bindingKey: 'other-binding' },
          ],
        },
      }),
    ).toEqual({
      ok: false,
      diagnostics: [goldenDiagnostic('duplicate participant')],
    });
    expect(
      validatePipelineSelections(consensus, {
        activity: { strategy: 'consensus', participants: [{ key: 'x', bindingKey: 'x-binding' }] },
      }),
    ).toEqual({
      ok: false,
      diagnostics: [goldenDiagnostic('policy count')],
    });
  });

  it('uses the JSON golden for malformed root and selection field diagnostics', () => {
    const source = validated();

    expect(validatePipelineSelections(source, null)).toEqual({
      ok: false,
      diagnostics: [goldenDiagnostic('invalid root')],
    });
    expect(
      validatePipelineSelections(source, {
        activity: {
          strategy: 'single',
          participant: { key: 'reviewer', bindingKey: 'reviewer' },
          unexpected: true,
        },
      }),
    ).toEqual({
      ok: false,
      diagnostics: [goldenDiagnostic('invalid record field')],
    });
  });

  it('uses one object key per selected agent node', () => {
    const source = sourceWithNodes([
      { ...sourceNodeBuilders.agent('second'), id: 'first' },
      { ...sourceNodeBuilders.agent(), id: 'second' },
      { kind: 'end', id: 'done', outcome: 'ok', output: {} },
    ]);
    expect(validatePipelineSource(source).ok).toBe(true);
  });

  it('reports consensus count after canonical participant ordering', () => {
    const consensus = validated(sourceForNode(consensusAgentNode()));
    const empty = {
      activity: { strategy: 'consensus', participants: [] },
    };
    const oversized = {
      activity: {
        strategy: 'consensus',
        participants: Array.from({ length: 33 }, (_, index) => ({
          key: `participant-${String(index).padStart(2, '0')}`,
          bindingKey: `binding-${String(index).padStart(2, '0')}`,
        })),
      },
    };
    const reordered = {
      activity: {
        strategy: 'consensus',
        participants: [
          { key: 'z', bindingKey: 'z-binding' },
          { key: 'a', bindingKey: 'later-binding' },
          { key: 'a', bindingKey: 'first-binding' },
        ],
      },
    };
    const reorderedAgain = {
      activity: {
        strategy: 'consensus',
        participants: [...reordered.activity.participants].reverse(),
      },
    };

    expect(validatePipelineSelections(consensus, empty)).toEqual({
      ok: false,
      diagnostics: [diagnostic('MATERIALIZATION_POLICY_COUNT', '/activity/participants')],
    });
    expect(validatePipelineSelections(consensus, oversized)).toEqual({
      ok: false,
      diagnostics: [diagnostic('MATERIALIZATION_POLICY_COUNT', '/activity/participants')],
    });
    expect(validatePipelineSelections(consensus, reordered)).toEqual(
      validatePipelineSelections(consensus, reorderedAgain),
    );
    expect(validatePipelineSelections(consensus, reordered)).toEqual({
      ok: false,
      diagnostics: [
        diagnostic('MATERIALIZATION_POLICY_COUNT', '/activity/participants'),
        diagnostic('MATERIALIZATION_PARTICIPANT_DUPLICATE', '/activity/participants/1/key'),
      ],
    });
  });

  it('accepts a root record for all 65 selected agent nodes', () => {
    const agents = Array.from({ length: 65 }, (_, index) => {
      const id = `agent-${String(index).padStart(2, '0')}`;
      const target = index === 64 ? 'done' : `agent-${String(index + 1).padStart(2, '0')}`;
      return { ...sourceNodeBuilders.agent(target), id };
    });
    const source = {
      ...sourceWithNodes(
        nonEmptyNodes([...agents, { kind: 'end', id: 'done', outcome: 'ok', output: {} }]),
      ),
      maximumTotalActivities: 65,
    };
    const selections = Object.fromEntries(
      agents.map(({ id }) => [
        id,
        { strategy: 'single' as const, participant: { key: 'reviewer', bindingKey: 'reviewer' } },
      ]),
    );

    expect(compilePipeline(source, selections).ok).toBe(true);
  });

  it('accepts 4096 root record entries and bounds the 4097th', () => {
    const selection = { strategy: 'single' as const, participant: { key: 'p', bindingKey: 'b' } };
    const entries = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `node-${String(index).padStart(4, '0')}`,
          selection,
        ]),
      );
    const source = validated(sourceWithNodes([endNode()]));
    const withinLimit = validatePipelineSelections(source, entries(4096));
    const overLimit = validatePipelineSelections(source, entries(4097));

    expect(withinLimit.ok).toBe(false);
    const withinLimitDiagnostics = withinLimit.ok ? [] : withinLimit.diagnostics;
    expect(withinLimitDiagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'BOUND_EXCEEDED' }),
    );
    expect(overLimit).toEqual({
      ok: false,
      diagnostics: [
        {
          family: 'BOUND',
          code: 'BOUND_EXCEEDED',
          path: '',
          message: PIPELINE_DIAGNOSTIC_CATALOG.BOUND_EXCEEDED.message,
        },
      ],
    });
  });

  it.each(['', '/', '~', '\u0000', 'e\u0301'])(
    'reports invalid hostile source-node ID key %j at its escaped record path',
    (sourceNodeId) => {
      expect(
        validatePipelineSelections(validated(), {
          [sourceNodeId]: {
            strategy: 'single',
            participant: { key: 'reviewer', bindingKey: 'reviewer' },
          },
        }),
      ).toEqual({
        ok: false,
        diagnostics: [
          diagnostic('MATERIALIZATION_SELECTION_INVALID', appendJsonPointer('', sourceNodeId)),
        ],
      });
    },
  );
});
