import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  expectValidMaterialization,
  singleMaterialization,
  validatedSource,
} from '../support/materialization-builders.js';

describe('materialization determinism', () => {
  it('pins exact canonical bytes and the normative digest preimage', async () => {
    const source = validatedSource();
    const materialization = expectValidMaterialization(
      singleMaterialization(source.sourceDigest),
      source,
    );
    const fixtureUrl = new URL('../fixtures/materialization/normalized.json', import.meta.url);
    const expectedText = (await readFile(fixtureUrl, 'utf8')).trim();
    const payload = Buffer.from(expectedText, 'utf8');
    const expectedDigest = `sha256:${createHash('sha256')
      .update(
        `revo-pipeline-digest-v1\npipeline-materialization/v1\n${payload.byteLength}\n`,
        'utf8',
      )
      .update(payload)
      .digest('hex')}`;

    expect(materialization.canonicalText).toBe(expectedText);
    expect(materialization.materializationDigest).toBe(expectedDigest);
    expect(materialization.materializationDigest).toBe(
      'sha256:f8524fd041185ecf7d41bc5170a1913a441fc30cc0ab88cf4fe3c5bfb729ed8b',
    );
  });
});
