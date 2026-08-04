import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import * as packageRoot from '../../src/index.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

test('ships exactly the accepted runtime root manifest', () => {
  expect(Object.keys(packageRoot).sort()).toEqual([
    'compilePipeline',
    'decidePipeline',
    'definePipeline',
  ]);
});

test('declares exactly one ESM-only root subpath and no production dependencies', async () => {
  const manifest: unknown = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
  expect(isRecord(manifest)).toBe(true);
  if (!isRecord(manifest)) {
    return;
  }
  expect(manifest['exports']).toEqual({
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.js',
    },
  });
  expect(manifest).toMatchObject({
    name: '@revisium/revo-pipeline',
    license: 'MIT',
    files: ['dist', 'README.md', 'LICENSE'],
    type: 'module',
    sideEffects: false,
    main: './dist/index.js',
    types: './dist/index.d.ts',
    publishConfig: { access: 'public', provenance: true },
  });
  expect(manifest['dependencies']).toBeUndefined();
});
