import type { Static } from 'typebox';
import { Compile } from 'typebox/compile';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { EmptyObjectSchema } from '../../../src/foundation/index.js';
import {
  ProgramProvenanceSchema,
  ProgramRequirementSchema,
  ProgramRequirementsSchema,
  type ProgramProvenance,
  type ProgramRequirement,
  type ProgramRequirements,
} from '../../../src/program/index.js';
import { programId } from '../../support/program-builders.js';

const requirementValidator = Compile(ProgramRequirementSchema);
const requirementsValidator = Compile(ProgramRequirementsSchema);
const provenanceValidator = Compile(ProgramProvenanceSchema);

const requirements = [
  {
    kind: 'agent',
    key: 'agent-binding',
    bindingKey: 'agent-binding',
    inputSchema: EmptyObjectSchema,
    outputSchema: EmptyObjectSchema,
  },
  {
    kind: 'script',
    key: 'script-binding',
    script: { key: 'script', revision: 0 },
    inputSchema: EmptyObjectSchema,
    outputSchema: EmptyObjectSchema,
  },
  {
    kind: 'effect',
    key: 'effect-binding',
    effectKey: 'effect',
    inputSchema: EmptyObjectSchema,
    outputSchema: EmptyObjectSchema,
  },
] as const satisfies readonly ProgramRequirement[];

const provenance = {
  schemaVersion: 'pipeline-provenance/v1',
  nodes: [
    {
      programNodeId: programId(),
      sourcePath: '/modules/0/region/nodes/0',
      materializationPath: '/slots/0/selection/participant',
      loweringRole: 'direct',
      ordinal: 0,
    },
  ],
  requirements: [
    {
      requirementKey: 'agent-binding',
      sourcePaths: ['/modules/0/region/nodes/0'],
      materializationPaths: ['/slots/0/selection/participant'],
    },
  ],
} as const satisfies ProgramProvenance;

describe('Program requirements and provenance contracts', () => {
  it('keeps runtime schemas aligned with exact static unions', () => {
    expectTypeOf<Static<typeof ProgramRequirementSchema>>().toEqualTypeOf<ProgramRequirement>();
    expectTypeOf<Static<typeof ProgramRequirementsSchema>>().toEqualTypeOf<ProgramRequirements>();
    expectTypeOf<Static<typeof ProgramProvenanceSchema>>().toEqualTypeOf<ProgramProvenance>();
  });

  it.each(requirements.map((requirement) => [requirement.kind, requirement] as const))(
    'accepts exact %s requirements and rejects extras',
    (_kind, requirement) => {
      expect(requirementValidator.Check(requirement)).toBe(true);
      expect(requirementValidator.Check({ ...requirement, hostBinding: {} })).toBe(false);
      for (const field of Object.keys(requirement)) {
        const incomplete = { ...requirement } as Record<string, unknown>;
        delete incomplete[field];
        expect(requirementValidator.Check(incomplete)).toBe(false);
      }
      expectTypeOf(requirement).toMatchTypeOf<ProgramRequirement>();
    },
  );

  it.each([
    ['script descriptor missing key', { ...requirements[1], script: { revision: 0 } }],
    [
      'script descriptor has unknown field',
      { ...requirements[1], script: { ...requirements[1].script, provider: 'host' } },
    ],
    [
      'script descriptor has wrong revision',
      { ...requirements[1], script: { key: 'script', revision: -1 } },
    ],
  ])('rejects nested requirement case: %s', (_name, invalid) => {
    expect(requirementValidator.Check(invalid)).toBe(false);
  });

  it('closes the requirement envelope and tagged union', () => {
    const envelope = { schemaVersion: 'pipeline-requirements/v1', entries: requirements };
    expect(requirementsValidator.Check(envelope)).toBe(true);
    expect(requirementsValidator.Check({ ...envelope, executable: true })).toBe(false);
    expect(
      requirementsValidator.Check({ ...envelope, schemaVersion: 'pipeline-requirements/v2' }),
    ).toBe(false);
    expect(requirementValidator.Check({ ...requirements[0], kind: 'runtime' })).toBe(false);
    for (const field of Object.keys(envelope)) {
      const incomplete = { ...envelope } as Record<string, unknown>;
      delete incomplete[field];
      expect(requirementsValidator.Check(incomplete)).toBe(false);
    }
  });

  it('accepts nullable and materialized provenance and rejects every undeclared field', () => {
    expect(provenanceValidator.Check(provenance)).toBe(true);
    expect(
      provenanceValidator.Check({
        ...provenance,
        nodes: [{ ...provenance.nodes[0], materializationPath: null }],
      }),
    ).toBe(true);
    expect(
      provenanceValidator.Check({
        ...provenance,
        nodes: [{ ...provenance.nodes[0], prompt: 'secret' }],
      }),
    ).toBe(false);
    expect(
      provenanceValidator.Check({
        ...provenance,
        requirements: [{ ...provenance.requirements[0], executor: 'host' }],
      }),
    ).toBe(false);
    for (const field of Object.keys(provenance.nodes[0])) {
      const incomplete = { ...provenance.nodes[0] } as Record<string, unknown>;
      delete incomplete[field];
      expect(provenanceValidator.Check({ ...provenance, nodes: [incomplete] })).toBe(false);
    }
    for (const field of Object.keys(provenance.requirements[0])) {
      const incomplete = { ...provenance.requirements[0] } as Record<string, unknown>;
      delete incomplete[field];
      expect(provenanceValidator.Check({ ...provenance, requirements: [incomplete] })).toBe(false);
    }
    for (const field of Object.keys(provenance)) {
      const incomplete = { ...provenance } as Record<string, unknown>;
      delete incomplete[field];
      expect(provenanceValidator.Check(incomplete)).toBe(false);
    }
  });

  it.each([
    ['program node digest', { ...provenance.nodes[0], programNodeId: 'node-key' }],
    ['lowering role', { ...provenance.nodes[0], loweringRole: 'plugin' }],
    ['negative ordinal', { ...provenance.nodes[0], ordinal: -1 }],
    ['empty source paths', { ...provenance.requirements[0], sourcePaths: [] }],
    ['non-string source path', { ...provenance.requirements[0], sourcePaths: [1] }],
    [
      'non-string materialization path',
      { ...provenance.requirements[0], materializationPaths: [1] },
    ],
  ])('rejects invalid %s provenance', (_name, invalid) => {
    const candidate =
      'programNodeId' in invalid
        ? { ...provenance, nodes: [invalid] }
        : { ...provenance, requirements: [invalid] };
    expect(provenanceValidator.Check(candidate)).toBe(false);
  });
});
