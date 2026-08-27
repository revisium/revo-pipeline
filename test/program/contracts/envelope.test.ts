import type { Static } from 'typebox';
import { Compile } from 'typebox/compile';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  PipelineProgramSchema,
  ProgramDigestInputSchema,
  ProgramProvenanceSchema,
  ProgramRegionSchema,
  ProgramRequirementsSchema,
  type PipelineProgram,
  type ProgramDigestInput,
  type ProgramProvenance,
  type ProgramRequirements,
} from '../../../src/program/index.js';
import {
  pipelineProgram,
  programId,
  programNodeExamples,
  programRegion,
} from '../../support/program-builders.js';

const validators = {
  program: Compile(PipelineProgramSchema),
  requirements: Compile(ProgramRequirementsSchema),
  provenance: Compile(ProgramProvenanceSchema),
  bundle: Compile(ProgramDigestInputSchema),
  region: Compile(ProgramRegionSchema),
};

const requirements = {
  schemaVersion: 'pipeline-requirements/v1',
  entries: [
    {
      kind: 'agent',
      key: 'binding',
      bindingKey: 'binding',
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      outputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  ],
} as const;

const provenance = {
  schemaVersion: 'pipeline-provenance/v1',
  nodes: [
    {
      programNodeId: programId(),
      sourceNodeId: null,
      sourcePath: '/modules/0/region/nodes/0',
      materializationPath: null,
      loweringRole: 'direct',
      ordinal: 0,
    },
  ],
  requirements: [
    {
      requirementKey: 'binding',
      sourcePaths: ['/modules/0/region/nodes/0'],
      materializationPaths: [],
    },
  ],
} as const;

describe('Program compiler-bundle contracts', () => {
  it('keeps every exported runtime schema aligned with its static contract', () => {
    expectTypeOf<Static<typeof PipelineProgramSchema>>().toEqualTypeOf<PipelineProgram>();
    expectTypeOf<Static<typeof ProgramRequirementsSchema>>().toEqualTypeOf<ProgramRequirements>();
    expectTypeOf<Static<typeof ProgramProvenanceSchema>>().toEqualTypeOf<ProgramProvenance>();
    expectTypeOf<Static<typeof ProgramDigestInputSchema>>().toEqualTypeOf<ProgramDigestInput>();
  });

  it('accepts the closed Program, requirements, provenance, and digest input', () => {
    const program = pipelineProgram();
    expect(validators.program.Check(program)).toBe(true);
    expect(validators.requirements.Check(requirements)).toBe(true);
    expect(validators.provenance.Check(provenance)).toBe(true);
    expect(validators.bundle.Check({ program, requirements, provenance })).toBe(true);
  });

  it('survives a JSON round trip and rejects unknown envelope fields', () => {
    const program = pipelineProgram();
    expect(validators.program.Check(JSON.parse(JSON.stringify(program)))).toBe(true);
    expect(validators.program.Check({ ...program, runtime: {} })).toBe(false);
    expect(validators.program.Check({ ...program, schemaVersion: 'pipeline-program/v2' })).toBe(
      false,
    );
  });

  it.each([
    'schemaVersion',
    'key',
    'sourceDigest',
    'materializationDigest',
    'entryModule',
    'maximumTotalActivities',
    'modules',
  ] as const)('requires PipelineProgram.%s', (field) => {
    const program = { ...pipelineProgram() } as Record<string, unknown>;
    delete program[field];
    expect(validators.program.Check(program)).toBe(false);
  });

  it.each(['key', 'inputSchema', 'outputSchema', 'region'] as const)(
    'requires every ProgramModule.%s field',
    (field) => {
      const program = pipelineProgram();
      const module = { ...program.modules[0] } as Record<string, unknown>;
      delete module[field];
      expect(validators.program.Check({ ...program, modules: [module] })).toBe(false);
    },
  );

  it.each(['id', 'inputSchema', 'entry', 'outputSchema', 'exits', 'nodes'] as const)(
    'requires recursive ProgramRegion.%s fields',
    (field) => {
      const region = { ...programRegion() } as Record<string, unknown>;
      delete region[field];
      expect(validators.region.Check(region)).toBe(false);
    },
  );

  it('validates nested regions recursively and rejects nested extras', () => {
    const parallel = programNodeExamples()[3];
    if (parallel?.kind !== 'parallel' || parallel.mode !== 'generic') {
      throw new TypeError('Expected generic parallel fixture.');
    }
    const nested = programRegion([parallel], programId('6'));
    expect(validators.region.Check(nested)).toBe(true);
    expect(
      validators.region.Check({
        ...nested,
        nodes: [
          {
            ...parallel,
            branches: [
              { ...parallel.branches[0], region: { ...parallel.branches[0].region, extra: true } },
              parallel.branches[1],
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  it.each(['program', 'requirements', 'provenance'] as const)(
    'requires ProgramDigestInput.%s and rejects sibling extras',
    (field) => {
      const bundle = { program: pipelineProgram(), requirements, provenance } as Record<
        string,
        unknown
      >;
      const incomplete = { ...bundle };
      delete incomplete[field];
      expect(validators.bundle.Check(incomplete)).toBe(false);
      expect(validators.bundle.Check({ ...bundle, executable: true })).toBe(false);
    },
  );

  it.each([
    [
      'nested Program version',
      {
        program: { ...pipelineProgram(), schemaVersion: 'pipeline-program/v2' },
        requirements,
        provenance,
      },
    ],
    [
      'nested requirements field',
      {
        program: pipelineProgram(),
        requirements: { ...requirements, runtime: true },
        provenance,
      },
    ],
    [
      'nested provenance field type',
      {
        program: pipelineProgram(),
        requirements,
        provenance: { ...provenance, nodes: 'not-an-array' },
      },
    ],
  ])('rejects invalid ProgramDigestInput %s', (_name, invalid) => {
    expect(validators.bundle.Check(invalid)).toBe(false);
  });
});
