import { describe, expect, it } from 'vitest';

import { compilePipeline, type ScriptPin } from '../../src/index.js';
import { createInitialPipelineState } from '../../src/kernel/index.js';
import { AgentActivityInputValueSchema, validatePipelineSource } from '../../src/source/index.js';
import {
  consensusAgentNode,
  consensusSelection,
  materializationFor,
  singleSelection,
} from '../support/compiler-builders.js';
import { sourceForNode, sourceNodeBuilders } from '../support/source-builders.js';

describe('direct kernel cutover source contracts', () => {
  it('uses the scripts-owned pin identity', () => {
    const pin: ScriptPin = { id: 'script:publish-comment', version: 1 };

    expect(pin).toEqual({ id: 'script:publish-comment', version: 1 });
  });

  it('accepts only a nonempty, single-line script pin identifier at runtime', () => {
    const source = sourceForNode(sourceNodeBuilders.script());
    const withScriptId = (id: string) => ({
      ...source,
      modules: source.modules.map((module, index) =>
        index === 0
          ? {
              ...module,
              region: {
                ...module.region,
                nodes: [
                  { ...module.region.nodes[0], script: { id, version: 1 } },
                  ...module.region.nodes.slice(1),
                ],
              },
            }
          : module,
      ),
    });

    expect(validatePipelineSource(withScriptId('script:publish-comment')).ok).toBe(true);
    expect(validatePipelineSource(withScriptId('script:')).ok).toBe(false);
    expect(validatePipelineSource(withScriptId('script:line\nbreak')).ok).toBe(false);
  });

  it('reports an invalid script pin at its id field', () => {
    const valid = sourceForNode(sourceNodeBuilders.script());
    const source = {
      ...valid,
      modules: valid.modules.map((module, index) =>
        index === 0
          ? {
              ...module,
              region: {
                ...module.region,
                nodes: [{ ...module.region.nodes[0], script: { id: 'invalid', version: 1 } }],
              },
            }
          : module,
      ),
    };

    expect(validatePipelineSource(source)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'CANONICAL_INPUT', path: '/modules/0/region/nodes/0/script/id' }],
    });
  });

  it('rejects the removed legacy activity source node', () => {
    const source = structuredClone(sourceForNode(sourceNodeBuilders.script()));
    const node = source.modules[0]?.region.nodes[0];
    if (node === undefined) {
      throw new TypeError('Expected a source node.');
    }
    const invalid = { ...node, kind: ['ef', 'fect'].join('') };

    expect(
      validatePipelineSource({
        ...source,
        modules: source.modules.map((module, index) =>
          index === 0
            ? {
                ...module,
                region: { ...module.region, nodes: [invalid, ...module.region.nodes.slice(1)] },
              }
            : module,
        ),
      }).ok,
    ).toBe(false);
  });

  it('requires every agent mapping to produce the fixed activity envelope', () => {
    const source = sourceForNode({
      ...sourceNodeBuilders.agent(),
      input: { prompt: { kind: 'scopeInput', pointer: '/prompt' } },
      inputSchema: AgentActivityInputValueSchema,
    });

    expect(compilePipeline(source, materializationFor(source, singleSelection())).ok).toBe(true);
    const invalid = sourceForNode({
      ...sourceNodeBuilders.agent(),
      input: {},
      inputSchema: AgentActivityInputValueSchema,
    });
    expect(compilePipeline(invalid, materializationFor(invalid, singleSelection())).ok).toBe(false);
  });

  it('rejects an agent source schema that differs from the fixed envelope', () => {
    const source = sourceForNode({
      ...sourceNodeBuilders.agent(),
      inputSchema: {
        type: 'object',
        properties: { prompt: { type: 'string' }, unexpected: { type: 'boolean' } },
        required: ['prompt'],
        additionalProperties: false,
      },
    });

    expect(compilePipeline(source, materializationFor(source, singleSelection()))).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: 'DATA_SCHEMA_INCOMPATIBLE',
          path: '/modules/0/region/nodes/0/inputSchema',
        },
      ],
    });
  });

  it('accepts literal prompts with an exact string schema for every agent lowering form', () => {
    const inputSchema = {
      type: 'object' as const,
      properties: {
        prompt: { type: 'string' as const, enum: ['Review'] as const },
      },
      required: ['prompt'] as const,
      additionalProperties: false as const,
    };
    const explicitConsensus = sourceNodeBuilders.consensus();
    const [firstParticipant, secondParticipant] = explicitConsensus.participants;
    if (firstParticipant === undefined || secondParticipant === undefined) {
      throw new TypeError('Expected explicit consensus participants.');
    }
    const forms = [
      {
        node: {
          ...sourceNodeBuilders.agent(),
          input: { prompt: { kind: 'literal' as const, value: 'Review' } },
          inputSchema,
        },
        selection: singleSelection(),
      },
      {
        node: {
          ...consensusAgentNode(),
          input: { prompt: { kind: 'literal' as const, value: 'Review' } },
          inputSchema,
        },
        selection: consensusSelection(),
      },
      {
        node: {
          ...explicitConsensus,
          participants: [
            {
              ...firstParticipant,
              input: { prompt: { kind: 'literal' as const, value: 'Review' } },
              inputSchema,
            },
            {
              ...secondParticipant,
              input: { prompt: { kind: 'literal' as const, value: 'Review' } },
              inputSchema,
            },
          ],
        },
        selection: undefined,
      },
    ] as const;

    for (const { node, selection } of forms) {
      const source = sourceForNode(node);
      expect(compilePipeline(source, materializationFor(source, selection)).ok).toBe(true);
    }
  });

  it('accepts nested portable metadata and emits it in the agent command', () => {
    const metadata = { nested: { attempt: 2 } };
    const source = sourceForNode({
      ...sourceNodeBuilders.agent(),
      input: {
        prompt: { kind: 'scopeInput', pointer: '/prompt' },
        metadata: { kind: 'literal', value: metadata },
      },
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          metadata: {
            type: 'object',
            properties: {
              nested: {
                type: 'object',
                properties: { attempt: { type: 'integer', minimum: 2, maximum: 2 } },
                required: ['attempt'],
                additionalProperties: false,
              },
            },
            required: ['nested'],
            additionalProperties: false,
          },
        },
        required: ['prompt', 'metadata'],
        additionalProperties: false,
      },
    });
    const compiled = compilePipeline(source, materializationFor(source, singleSelection()));

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }
    const initial = createInitialPipelineState(
      { program: compiled.program, programDigest: compiled.programDigest },
      { prompt: 'Review the metadata.' },
    );
    expect(initial.commands).toContainEqual(
      expect.objectContaining({
        kind: 'dispatchActivity',
        input: { prompt: 'Review the metadata.', metadata },
      }),
    );
  });

  it('rejects arbitrary top-level agent input fields', () => {
    const source = sourceForNode(sourceNodeBuilders.agent());
    expect(
      validatePipelineSource({
        ...source,
        modules: source.modules.map((module, index) =>
          index === 0
            ? {
                ...module,
                region: {
                  ...module.region,
                  nodes: [
                    { ...module.region.nodes[0], unexpected: { kind: 'literal', value: true } },
                    ...module.region.nodes.slice(1),
                  ],
                },
              }
            : module,
        ),
      }).ok,
    ).toBe(false);
  });
});
