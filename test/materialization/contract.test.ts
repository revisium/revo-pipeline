import { Compile } from 'typebox/compile';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  PipelineSelectionsSchema,
  type PipelineSelections,
  validatePipelineSelections,
} from '../../src/materialization/index.js';
import { singleMaterialization, validatedSource } from '../support/materialization-builders.js';

describe('public pipeline selections', () => {
  it('exports one closed runtime and exact static contract', () => {
    const selections = singleMaterialization(validatedSource().sourceDigest);
    const validator = Compile(PipelineSelectionsSchema);

    expect(validator.Check(selections)).toBe(true);
    expect(validator.Check({ ...selections, undeclared: true })).toBe(false);
    expectTypeOf(selections).toEqualTypeOf<PipelineSelections>();
  });

  it('totalizes hostile public input', () => {
    const source = validatedSource();
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    expect(() => validatePipelineSelections(source, revoked.proxy)).not.toThrow();
  });
});
