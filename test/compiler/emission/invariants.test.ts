import { describe, expect, it } from 'vitest';

import { compilePipeline, emitProgramBundle } from '../../../src/compiler/index.js';
import type { JsonPointer } from '../../../src/foundation/index.js';
import type {
  NodeProvenance,
  PipelineProgram,
  ProgramNodeId,
  ProgramRegion,
} from '../../../src/program/index.js';
import { materializationFor } from '../../support/compiler-builders.js';
import {
  pipelineProgram,
  programEnd,
  programNodeExamples,
} from '../../support/program-builders.js';
import { sourceForNode, sourceNodeBuilders } from '../../support/source-builders.js';

const provenance = (programNodeId: ProgramNodeId, sourcePath: JsonPointer): NodeProvenance => ({
  programNodeId,
  sourcePath,
  materializationPath: null,
  loweringRole: 'direct',
  ordinal: 0,
});

const withRegion = (region: ProgramRegion): PipelineProgram => {
  const program = pipelineProgram();
  const module = program.modules[0];
  return { ...program, modules: [{ ...module, region }] };
};

const failureCodes = (result: ReturnType<typeof emitProgramBundle>): readonly string[] => {
  if (result.ok) {
    throw new TypeError('Expected bundle emission failure.');
  }
  expect(Object.keys(result).toSorted()).toEqual(['diagnostics', 'ok']);
  return result.diagnostics.map(({ code }) => code);
};

const structuralIds = (region: ProgramRegion): readonly ProgramNodeId[] => [
  region.id,
  ...region.nodes.flatMap((node) => [
    node.id,
    ...(node.kind === 'parallel'
      ? node.branches.flatMap(({ region: child }) => structuralIds(child))
      : node.kind === 'repeat' || node.kind === 'map'
        ? structuralIds(node.body)
        : []),
  ]),
];

describe('compiler emission invariants', () => {
  it('rejects an activity without an emitted requirement', () => {
    const activity = programNodeExamples()[0];
    if (activity?.kind !== 'activity') {
      throw new TypeError('Expected activity fixture.');
    }
    const end = programEnd();
    const region: ProgramRegion = {
      ...pipelineProgram().modules[0].region,
      entry: activity.id,
      nodes: [activity, end],
    };
    const result = emitProgramBundle({
      program: withRegion(region),
      requirementUses: [],
      nodeProvenance: [
        provenance(region.id, '/modules/0/region'),
        provenance(activity.id, '/modules/0/region/nodes/0'),
        provenance(end.id, '/modules/0/region/nodes/1'),
      ],
    });

    expect(failureCodes(result)).toContain('REQUIREMENT_MISSING');
  });

  it('rejects a declared requirement without an activity consumer', () => {
    const program = pipelineProgram();
    const region = program.modules[0].region;
    const end = region.nodes[0];
    const result = emitProgramBundle({
      program,
      nodeProvenance: [
        provenance(region.id, '/modules/0/region'),
        provenance(end.id, '/modules/0/region/nodes/0'),
      ],
      requirementUses: [
        {
          requirement: {
            kind: 'script',
            key: 'unused',
            script: { key: 'unused', revision: 0 },
            inputSchema: region.inputSchema,
            outputSchema: region.outputSchema,
          },
          sourcePath: '/modules/0/region/nodes/0',
          materializationPath: null,
        },
      ],
    });

    expect(failureCodes(result)).toContain('REQUIREMENT_UNUSED');
  });

  it('rejects duplicate structural and provenance IDs', () => {
    const end = programEnd();
    const region: ProgramRegion = {
      ...pipelineProgram().modules[0].region,
      id: end.id,
      entry: end.id,
      nodes: [end],
    };
    const result = emitProgramBundle({
      program: withRegion(region),
      requirementUses: [],
      nodeProvenance: [
        provenance(end.id, '/modules/0/region'),
        provenance(end.id, '/modules/0/region/nodes/0'),
      ],
    });

    expect(failureCodes(result)).toContain('LOWERING_ID_COLLISION');
  });

  it('covers every emitted region and node with exactly one provenance record', () => {
    const source = sourceForNode(sourceNodeBuilders.parallel());
    const result = compilePipeline(source, materializationFor(source));
    if (!result.ok) {
      throw new TypeError(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
    }
    const expected = result.program.modules
      .flatMap(({ region }) => structuralIds(region))
      .toSorted();
    const actual = result.provenance.nodes.map(({ programNodeId }) => programNodeId).toSorted();

    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(actual.length);
  });

  it('keeps runtime and host binding data outside emitted requirements and provenance', () => {
    const source = sourceForNode(sourceNodeBuilders.script());
    const result = compilePipeline(source, materializationFor(source));
    if (!result.ok) {
      throw new TypeError(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
    }

    expect(Object.keys(result.requirements.entries[0] ?? {}).toSorted()).toEqual([
      'inputSchema',
      'key',
      'kind',
      'outputSchema',
      'script',
    ]);
    expect(Object.keys(result.provenance.nodes[0] ?? {}).toSorted()).toEqual([
      'loweringRole',
      'materializationPath',
      'ordinal',
      'programNodeId',
      'sourcePath',
    ]);
    expect(
      JSON.stringify({ requirements: result.requirements, provenance: result.provenance }),
    ).not.toMatch(/executor|model|prompt|runtime/u);
  });
});
