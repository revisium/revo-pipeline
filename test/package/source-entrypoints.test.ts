import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { validateModuleStructure } from '../../scripts/architecture/validate-module-structure.js';
import * as packageRoot from '../../src/index.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

test('ships exactly the accepted explicit source and runtime root manifest', async () => {
  const source = await readFile(join(process.cwd(), 'src/index.ts'), 'utf8');
  expect(() => validateModuleStructure([{ path: 'src/index.ts', source }])).not.toThrow();
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
  expect(manifest['dependencies']).toBeUndefined();
});
