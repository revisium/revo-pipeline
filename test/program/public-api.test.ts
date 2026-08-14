import { describe, expect, it } from 'vitest';

import {
  compilePipeline,
  computeMaterializationDigest,
  computeProgramDigest,
  computeSourceDigest,
  definePipelineSource,
  defineProfileMaterialization,
  type PipelineProgram,
  type ProgramDigestInput,
  type ProgramNode,
  type ProgramNodeId,
  type ProgramRegion,
} from '../../src/index.js';
import { createInitialPipelineState } from '../../src/kernel/public.js';
import { materializationFor } from '../support/compiler-builders.js';
import { sourceForNode, sourceNodeBuilders } from '../support/source-builders.js';

const invalidDigestMessage = 'Invalid pipeline digest input.';

const compiledScript = () => {
  const source = sourceForNode(sourceNodeBuilders.script());
  const result = compilePipeline(source, materializationFor(source));
  if (!result.ok) {
    throw new TypeError(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
  }
  return result;
};

const digestId = (value: number): ProgramNodeId => `sha256:${value.toString(16).padStart(64, '0')}`;

const nonEmpty = <Value>(values: readonly Value[]): [Value, ...Value[]] => {
  const [first, ...remaining] = values;
  if (first === undefined) {
    throw new TypeError('Expected a non-empty Program fixture collection.');
  }
  return [first, ...remaining];
};

const childRegions = (node: ProgramNode): readonly ProgramRegion[] => {
  if (node.kind === 'parallel') {
    return node.branches.map(({ region }) => region);
  }
  return node.kind === 'repeat' || node.kind === 'map' ? [node.body] : [];
};

const digestInputFor = (program: PipelineProgram): ProgramDigestInput => {
  const ids: ProgramNodeId[] = [];
  const pending = program.modules.map(({ region }) => region);
  while (pending.length > 0) {
    const region = pending.pop();
    if (region === undefined) {
      continue;
    }
    ids.push(region.id, ...region.nodes.map(({ id }) => id));
    pending.push(...region.nodes.flatMap(childRegions));
  }
  return {
    program,
    requirements: { schemaVersion: 'pipeline-requirements/v1', entries: [] },
    provenance: {
      schemaVersion: 'pipeline-provenance/v1',
      nodes: ids.toSorted().map((programNodeId, ordinal) => ({
        programNodeId,
        sourcePath: '/fixture',
        materializationPath: null,
        loweringRole: 'direct',
        ordinal,
      })),
      requirements: [],
    },
  };
};

const nestedProgram = (depth: number): PipelineProgram => {
  let region: ProgramRegion = {
    id: digestId(20_000 + depth),
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    entry: digestId(10_000 + depth * 2),
    outputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    exits: [
      {
        outcome: 'ok',
        outputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    ],
    nodes: [{ kind: 'end', id: digestId(10_000 + depth * 2), outcome: 'ok', output: {} }],
  };
  for (let ordinal = depth - 1; ordinal >= 0; ordinal -= 1) {
    const repeatId = digestId(10_000 + ordinal * 2);
    const endId = digestId(10_001 + ordinal * 2);
    const repeat: ProgramNode = {
      kind: 'repeat',
      id: repeatId,
      maximumIterations: 1,
      initialInput: {},
      nextInput: {},
      body: region,
      bodyExits: [{ outcome: 'ok', classification: 'value' }],
      continueWhen: { kind: 'exists', selector: { kind: 'literal', value: true } },
      output: {},
      outputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      routes: { completed: endId, exhausted: endId, failed: endId, cancelled: endId },
    };
    const terminal: ProgramNode = { kind: 'end', id: endId, outcome: 'ok', output: {} };
    region = {
      id: digestId(20_000 + ordinal),
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      entry: repeatId,
      outputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      exits: [
        {
          outcome: 'ok',
          outputSchema: {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      ],
      nodes: nonEmpty<ProgramNode>(
        [repeat, terminal].toSorted((left, right) => left.id.localeCompare(right.id)),
      ),
    };
  }
  return {
    schemaVersion: 'pipeline-program/v1',
    key: 'nested',
    sourceDigest: digestId(50_000),
    materializationDigest: digestId(50_001),
    entryModule: 'main',
    maximumTotalActivities: 1,
    modules: [
      {
        key: 'main',
        inputSchema: region.inputSchema,
        outputSchema: region.outputSchema,
        region,
      },
    ],
  };
};

describe('public authoring and digest helpers', () => {
  it('returns identity-helper inputs without observing them', () => {
    const sourceValue = sourceForNode(sourceNodeBuilders.script());
    const source = new Proxy(sourceValue, {
      getOwnPropertyDescriptor: () => {
        throw new Error('identity helper inspected source');
      },
    });
    const materialization = Proxy.revocable(materializationFor(sourceValue), {});
    materialization.revoke();

    expect(definePipelineSource(source)).toBe(source);
    expect(defineProfileMaterialization(materialization.proxy)).toBe(materialization.proxy);
  });

  it('returns compiler digests through the public validation paths', () => {
    const result = compiledScript();

    expect(computeSourceDigest(sourceForNode(sourceNodeBuilders.script()))).toBe(
      result.sourceDigest,
    );
    expect(
      computeMaterializationDigest({
        schemaVersion: 'pipeline-materialization/v1',
        sourceDigest: result.sourceDigest,
        slots: [],
      }),
    ).toBe(result.materializationDigest);
    expect(
      computeProgramDigest({
        program: result.program,
        requirements: result.requirements,
        provenance: result.provenance,
      }),
    ).toBe(result.programDigest);
  });

  it('keeps materialization digest validation intrinsic to its own envelope', () => {
    const result = compiledScript();
    expect(() =>
      computeMaterializationDigest({
        schemaVersion: 'pipeline-materialization/v1',
        sourceDigest: result.sourceDigest,
        slots: [],
      }),
    ).not.toThrow();
  });

  it('rejects invalid, cyclic, and hostile digest inputs with one redacted error', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const calls = [
      () => {
        Reflect.apply(computeSourceDigest, undefined, [{}]);
      },
      () => {
        Reflect.apply(computeMaterializationDigest, undefined, [cycle]);
      },
      () => {
        Reflect.apply(computeProgramDigest, undefined, [revoked.proxy]);
      },
    ];

    for (const call of calls) {
      expect(call).toThrowError(new TypeError(invalidDigestMessage));
    }
  });

  it('rejects schema-valid bundles with incomplete Program and provenance semantics', () => {
    const result = compiledScript();
    const bundle = structuredClone({
      program: result.program,
      requirements: result.requirements,
      provenance: result.provenance,
    });
    const module = bundle.program.modules[0];
    if (module === undefined) {
      throw new TypeError('Expected compiled module.');
    }
    const mismatchedProgram = {
      ...bundle.program,
      modules: [{ ...module, inputSchema: { type: 'null' as const } }],
    };
    const missingProvenance = {
      ...bundle,
      provenance: { ...bundle.provenance, nodes: bundle.provenance.nodes.slice(1) },
    };
    const requirement = bundle.requirements.entries[0];
    if (requirement === undefined) {
      throw new TypeError('Expected compiled requirement.');
    }
    const mismatchedRequirementKind = {
      ...bundle,
      requirements: {
        ...bundle.requirements,
        entries: [
          {
            kind: 'agent' as const,
            key: requirement.key,
            bindingKey: 'wrong-requirement-kind',
            inputSchema: requirement.inputSchema,
            outputSchema: requirement.outputSchema,
          },
        ],
      },
    };

    expect(() => {
      Reflect.apply(computeProgramDigest, undefined, [{ ...bundle, program: mismatchedProgram }]);
    }).toThrowError(new TypeError(invalidDigestMessage));
    expect(() => computeProgramDigest(missingProvenance)).toThrowError(
      new TypeError(invalidDigestMessage),
    );
    expect(() => computeProgramDigest(mismatchedRequirementKind)).toThrowError(
      new TypeError(invalidDigestMessage),
    );
  });

  it('applies complete Program admission before public hashing and kernel execution', () => {
    const result = compiledScript();
    const base = structuredClone({
      program: result.program,
      requirements: result.requirements,
      provenance: result.provenance,
    });
    const missingId = digestId(99_999);
    const mutateDirect = (
      mutate: (node: Extract<ProgramNode, { readonly kind: 'activity' }>) => ProgramNode,
    ): PipelineProgram => {
      const program = structuredClone(base.program);
      const module = program.modules[0];
      const node = module?.region.nodes.find(
        (candidate): candidate is Extract<ProgramNode, { readonly kind: 'activity' }> =>
          candidate.kind === 'activity',
      );
      if (module === undefined || node === undefined) {
        throw new TypeError('Expected a compiled activity Program.');
      }
      return {
        ...program,
        modules: [
          {
            ...module,
            region: {
              ...module.region,
              nodes: nonEmpty(
                module.region.nodes.map((candidate) =>
                  candidate.id === node.id ? mutate(node) : candidate,
                ),
              ),
            },
          },
        ],
      };
    };
    const badEntry: PipelineProgram = {
      ...base.program,
      modules: nonEmpty(
        base.program.modules.map((module) => ({
          ...module,
          region: { ...module.region, entry: missingId },
        })),
      ),
    };
    const cases: readonly PipelineProgram[] = [
      badEntry,
      mutateDirect((node) => ({
        ...node,
        routes: { ...node.routes, succeeded: missingId },
      })),
      mutateDirect((node) => ({
        ...node,
        routes: { ...node.routes, succeeded: node.id },
      })),
      mutateDirect((node) => ({
        ...node,
        input: { value: { kind: 'scopeInput', pointer: '/missing' } },
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      })),
      mutateDirect((node) => ({
        ...node,
        input: { value: { kind: 'literal', value: 1 } },
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
      })),
      (() => {
        const program = nestedProgram(1);
        const module = program.modules[0];
        const node = module?.region.nodes.find(
          (candidate): candidate is Extract<ProgramNode, { readonly kind: 'repeat' }> =>
            candidate.kind === 'repeat',
        );
        if (module === undefined || node === undefined) {
          throw new TypeError('Expected a nested Program fixture.');
        }
        return {
          ...program,
          modules: [
            {
              ...module,
              region: {
                ...module.region,
                nodes: nonEmpty(
                  module.region.nodes.map((candidate) =>
                    candidate.id === node.id
                      ? {
                          ...node,
                          bodyExits: [{ outcome: 'missing', classification: 'value' }],
                        }
                      : candidate,
                  ),
                ),
              },
            },
          ],
        };
      })(),
      (() => {
        const program = nestedProgram(1);
        const module = program.modules[0];
        const node = module?.region.nodes.find(
          (candidate): candidate is Extract<ProgramNode, { readonly kind: 'repeat' }> =>
            candidate.kind === 'repeat',
        );
        if (module === undefined || node === undefined) {
          throw new TypeError('Expected a nested Program fixture.');
        }
        const call: ProgramNode = {
          kind: 'call',
          id: node.id,
          module: 'missing-module',
          input: {},
          outputSchema: node.outputSchema,
          routes: {
            outcomes: [{ outcome: 'ok', target: node.routes.completed }],
            failed: node.routes.failed,
            cancelled: node.routes.cancelled,
          },
        };
        return {
          ...program,
          modules: [
            {
              ...module,
              region: {
                ...module.region,
                nodes: nonEmpty(
                  module.region.nodes.map((candidate) =>
                    candidate.id === node.id ? call : candidate,
                  ),
                ),
              },
            },
          ],
        };
      })(),
      nestedProgram(33),
    ];

    for (const program of cases) {
      const input =
        program === base.program
          ? base
          : program.key === 'nested'
            ? digestInputFor(program)
            : { ...base, program };
      expect(() => computeProgramDigest(input)).toThrowError(new TypeError(invalidDigestMessage));
      expect(
        createInitialPipelineState({ program, programDigest: digestId(0) }, {}).state.fault,
      ).toEqual({ code: 'PROGRAM_INVALID', path: '/program' });
    }
  });
});
