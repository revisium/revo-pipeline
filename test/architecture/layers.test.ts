import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const manifest: unknown = JSON.parse(
  readFileSync(join(repositoryRoot, 'architecture', 'layers.json'), 'utf8'),
);

const expectedManifest = {
  schemaVersion: 'revo-pipeline-layers/v1',
  sourceRoot: 'src',
  rootModule: 'src/index.ts',
  layers: [
    {
      name: 'foundation',
      path: 'src/foundation',
      dependencies: [],
    },
    {
      name: 'source',
      path: 'src/source',
      dependencies: ['foundation'],
    },
    {
      name: 'materialization',
      path: 'src/materialization',
      dependencies: ['foundation', 'source'],
    },
    {
      name: 'program',
      path: 'src/program',
      dependencies: ['foundation'],
    },
    {
      name: 'compiler',
      path: 'src/compiler',
      dependencies: ['foundation', 'source', 'materialization', 'program'],
    },
    {
      name: 'kernel',
      path: 'src/kernel',
      dependencies: ['foundation', 'program'],
    },
  ],
} as const;

describe('canonical layer manifest', () => {
  it('pins the layer state and dependency DAG', () => {
    expect(manifest).toEqual(expectedManifest);
  });

  it('materializes exactly the six dependency layers and two public facades', () => {
    expect(readdirSync(join(repositoryRoot, 'src')).toSorted()).toEqual([
      'compiler',
      'foundation',
      'index.ts',
      'kernel',
      'materialization',
      'program',
      'source',
    ]);
    expect(existsSync(join(repositoryRoot, 'src', 'foundation', 'index.ts'))).toBe(true);
    expect(existsSync(join(repositoryRoot, 'src', 'kernel', 'public.ts'))).toBe(true);
    expect(existsSync(join(repositoryRoot, 'src', 'extensions'))).toBe(false);
  });
});
