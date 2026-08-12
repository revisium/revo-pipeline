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
      state: 'active',
      public: false,
      dependencies: [],
    },
    {
      name: 'source',
      path: 'src/source',
      state: 'active',
      public: false,
      dependencies: ['foundation'],
    },
    {
      name: 'materialization',
      path: 'src/materialization',
      state: 'active',
      public: false,
      dependencies: ['foundation', 'source'],
    },
    {
      name: 'program',
      path: 'src/program',
      state: 'active',
      public: false,
      dependencies: ['foundation'],
    },
    {
      name: 'compiler',
      path: 'src/compiler',
      state: 'active',
      public: false,
      dependencies: ['foundation', 'source', 'materialization', 'program'],
    },
    {
      name: 'kernel',
      path: 'src/kernel',
      state: 'active',
      public: false,
      dependencies: ['foundation', 'program'],
    },
    {
      name: 'extensions',
      path: 'src/extensions',
      state: 'future',
      public: false,
      dependencies: ['source', 'materialization', 'compiler'],
    },
  ],
} as const;

describe('canonical layer manifest', () => {
  it('pins the layer state and dependency DAG', () => {
    expect(manifest).toEqual(expectedManifest);
  });

  it('materializes only the six active private layers', () => {
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
    for (const layer of expectedManifest.layers.filter(({ state }) => state === 'future')) {
      expect(existsSync(join(repositoryRoot, layer.path))).toBe(false);
    }
  });
});
