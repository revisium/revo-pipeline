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
  currentItem: 'rp-01',
  sourceRoot: 'src',
  rootModule: 'src/index.ts',
  layers: [
    {
      name: 'foundation',
      path: 'src/foundation',
      activation: 'rp-01',
      state: 'active',
      public: false,
      dependencies: [],
    },
    {
      name: 'source',
      path: 'src/source',
      activation: 'rp-02',
      state: 'future',
      public: false,
      dependencies: ['foundation'],
    },
    {
      name: 'materialization',
      path: 'src/materialization',
      activation: 'rp-02',
      state: 'future',
      public: false,
      dependencies: ['foundation', 'source'],
    },
    {
      name: 'program',
      path: 'src/program',
      activation: 'rp-03',
      state: 'future',
      public: false,
      dependencies: ['foundation'],
    },
    {
      name: 'compiler',
      path: 'src/compiler',
      activation: 'rp-03',
      state: 'future',
      public: false,
      dependencies: ['foundation', 'source', 'materialization', 'program'],
    },
    {
      name: 'kernel',
      path: 'src/kernel',
      activation: 'rp-04',
      state: 'future',
      public: false,
      dependencies: ['foundation', 'program'],
    },
    {
      name: 'extensions',
      path: 'src/extensions',
      activation: 'rp-05',
      state: 'future',
      public: false,
      dependencies: ['source', 'materialization', 'compiler'],
    },
  ],
} as const;

describe('canonical layer manifest', () => {
  it('pins the rp-01 activation state and dependency DAG', () => {
    expect(manifest).toEqual(expectedManifest);
  });

  it('materializes only the active foundation layer', () => {
    expect(readdirSync(join(repositoryRoot, 'src')).toSorted()).toEqual(['foundation', 'index.ts']);
    expect(existsSync(join(repositoryRoot, 'src', 'foundation', 'index.ts'))).toBe(true);
    for (const layer of expectedManifest.layers.filter(({ state }) => state === 'future')) {
      expect(existsSync(join(repositoryRoot, layer.path))).toBe(false);
    }
  });
});
