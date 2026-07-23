import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import * as packageRoot from '../../src/index.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

test('keeps the bootstrap source root text and runtime surface exactly empty', async () => {
  expect(await readFile(join(process.cwd(), 'src/index.ts'), 'utf8')).toBe('export {};\n');
  expect(Object.keys(packageRoot)).toEqual([]);
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
