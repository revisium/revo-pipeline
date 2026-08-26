import { describe, expect, it } from 'vitest';

import {
  materializationDiagnostics,
  singleMaterialization,
  validatedSource,
} from '../support/materialization-builders.js';

describe('selection coverage', () => {
  it('reports an extra public node ID at its input path', () => {
    const source = validatedSource();
    const selections = singleMaterialization(source.sourceDigest);
    const input = {
      ...selections,
      other: { strategy: 'single', participant: { key: 'p2', bindingKey: 'b2' } },
    };

    expect(materializationDiagnostics(input, source)).toContainEqual({
      code: 'MATERIALIZATION_SLOT_EXTRA',
      path: '/other',
    });
  });
});
