import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { validateModuleStructure } from '../../scripts/architecture/validate-module-structure.js';
import { validatePackageVerifierFlow } from '../../scripts/architecture/validate-package-verifier-flow.js';
import {
  HOST_SHAPED_CONSUMER_SOURCE,
  TYPE_CONSUMER_SOURCE,
} from '../../scripts/package/package-consumer-fixtures.js';
import { planTypeClosure } from '../../scripts/package/package-type-closure.js';
import * as packageRoot from '../../src/index.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

test('ships exactly the accepted explicit source and runtime root manifest', async () => {
  const source = await readFile(join(process.cwd(), 'src/index.ts'), 'utf8');
  expect(() => validateModuleStructure([{ path: 'src/index.ts', source }])).not.toThrow();
  expect(Object.keys(packageRoot).sort()).toEqual([
    'compilePipeline',
    'decidePipeline',
    'decodeCompiledPipeline',
    'definePipeline',
    'reducePipeline',
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
    version: '0.0.0',
    description: 'Portable pipeline definition, compilation, and transition semantics for Revo.',
    homepage: 'https://github.com/revisium/revo-pipeline#readme',
    bugs: { url: 'https://github.com/revisium/revo-pipeline/issues' },
    license: 'MIT',
    repository: { type: 'git', url: 'git+https://github.com/revisium/revo-pipeline.git' },
    files: ['dist', 'README.md', 'LICENSE'],
    type: 'module',
    sideEffects: false,
    main: './dist/index.js',
    types: './dist/index.d.ts',
    engines: { node: '>=24.11.1 <25' },
    packageManager: 'pnpm@11.13.0',
    publishConfig: { access: 'public', provenance: true },
  });
  expect(manifest['dependencies']).toBeUndefined();
});

test('keeps package verification on exactly one pack invocation', async () => {
  expect(() => validatePackageVerifierFlow(process.cwd())).not.toThrow();
});

test('keeps packed union growth fail-closed at full-object never calls', () => {
  for (const source of [TYPE_CONSUMER_SOURCE, HOST_SHAPED_CONSUMER_SOURCE]) {
    expect(source).toContain('assertNever(decision);');
    expect(source).toContain('assertNever(reduction);');
  }
});

test('records the current type closure outside the generic production planner', () => {
  const plan = planTypeClosure({
    rootName: '@types/node',
    rootRange: '24.13.3',
    rootVersion: '24.13.3',
    nodes: [
      {
        name: '@types/node',
        version: '24.13.3',
        sourceId: 'workspace-parent-local-node',
        manifestDependencies: { 'undici-types': '~7.18.0' },
        snapshotDependencies: { 'undici-types': '7.18.2' },
      },
      {
        name: 'undici-types',
        version: '7.18.2',
        sourceId: 'node-parent-local-undici',
        manifestDependencies: {},
        snapshotDependencies: {},
      },
    ],
  });
  expect(plan.map(({ name, version }) => `${name}@${version}`)).toEqual([
    'undici-types@7.18.2',
    '@types/node@24.13.3',
  ]);
});
