import { describe, expect, expectTypeOf, it } from 'vitest';

import * as foundation from '../../../src/foundation/index.js';
import * as source from '../../../src/source/index.js';

const movedBindings = [
  ['DigestSchema', source.DigestSchema, foundation.DigestSchema],
  ['JsonPointerSchema', source.JsonPointerSchema, foundation.JsonPointerSchema],
  ['ChoiceDomainSchema', source.ChoiceDomainSchema, foundation.ChoiceDomainSchema],
  ['EmptyObjectSchema', source.EmptyObjectSchema, foundation.EmptyObjectSchema],
  [
    'PipelineFailureValueSchema',
    source.PipelineFailureValueSchema,
    foundation.PipelineFailureValueSchema,
  ],
  ['ValueSchemaSchema', source.ValueSchemaSchema, foundation.ValueSchemaSchema],
  ['ConsensusPolicySchema', source.ConsensusPolicySchema, foundation.ConsensusPolicySchema],
  ['casesCoverFiniteDomain', source.casesCoverFiniteDomain, foundation.casesCoverFiniteDomain],
  ['compareCanonicalScalars', source.compareCanonicalScalars, foundation.compareCanonicalScalars],
  ['finiteDomainOf', source.finiteDomainOf, foundation.finiteDomainOf],
  ['isPipelineFailureSchema', source.isPipelineFailureSchema, foundation.isPipelineFailureSchema],
  ['normalizeChoiceDomain', source.normalizeChoiceDomain, foundation.normalizeChoiceDomain],
  ['normalizeValueSchema', source.normalizeValueSchema, foundation.normalizeValueSchema],
  ['projectValueSchema', source.projectValueSchema, foundation.projectValueSchema],
  ['valueSchemasEqual', source.valueSchemasEqual, foundation.valueSchemasEqual],
] as const;

describe('foundation-owned source vocabulary', () => {
  it.each(movedBindings)('keeps %s as the exact source runtime binding', (_name, actual, owner) => {
    expect(actual).toBe(owner);
  });

  it('keeps every moved source type identical to its foundation owner', () => {
    expectTypeOf<source.ValueSchema>().toEqualTypeOf<foundation.ValueSchema>();
    expectTypeOf<source.ChoiceDomain>().toEqualTypeOf<foundation.ChoiceDomain>();
    expectTypeOf<source.ConsensusPolicy>().toEqualTypeOf<foundation.ConsensusPolicy>();
    expectTypeOf<source.ParallelPolicy>().toEqualTypeOf<foundation.ParallelPolicy>();
    expectTypeOf<source.ParallelBranchClassification>().toEqualTypeOf<foundation.ParallelBranchClassification>();
    expectTypeOf<source.RegionExitClassification<'value'>>().toEqualTypeOf<
      foundation.RegionExitClassification<'value'>
    >();
    expectTypeOf<source.FiniteDomain>().toEqualTypeOf<foundation.FiniteDomain>();
  });
});
