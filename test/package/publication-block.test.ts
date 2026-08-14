import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as runtimeSurface from '../../src/index.js';
import * as kernelSurface from '../../src/kernel/public.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const packageJson: unknown = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

describe('under-development package boundary', () => {
  it('validates the alpha package manifest and exact entrypoints', () => {
    expect(isRecord(packageJson)).toBe(true);
    if (!isRecord(packageJson)) {
      return;
    }

    expect(packageJson.version).toBe('0.1.0-alpha.1');
    expect(Object.hasOwn(packageJson, 'private')).toBe(false);
    expect(packageJson.type).toBe('module');
    expect(packageJson.dependencies).toEqual({ canonicalize: '3.0.0', typebox: '1.3.10' });
    expect(packageJson.main).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.files).toEqual(['dist', 'README.md', 'LICENSE']);
    expect(packageJson.exports).toEqual({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './kernel': {
        types: './dist/kernel/public.d.ts',
        import: './dist/kernel/public.js',
      },
    });
    expect(packageJson.publishConfig).toEqual({ access: 'public', tag: 'alpha' });
    for (const field of [
      'optionalDependencies',
      'peerDependencies',
      'bundledDependencies',
      'bundleDependencies',
    ]) {
      expect(Object.hasOwn(packageJson, field)).toBe(false);
    }

    expect(isRecord(packageJson.scripts)).toBe(true);
    if (!isRecord(packageJson.scripts)) {
      return;
    }
    expect(Object.hasOwn(packageJson.scripts, 'prepublishOnly')).toBe(false);
    expect(packageJson.scripts.prepack).toBe('pnpm run build');
  });

  it('keeps the exact reviewed workflow inventory', () => {
    expect(readdirSync(join(repositoryRoot, '.github', 'workflows')).toSorted()).toEqual([
      'ci.yml',
      'npm-publish.yml',
      'release-train.yml',
      'release.yml',
    ]);
  });

  it('exposes only the exact root and kernel runtime values', () => {
    expect(Object.keys(runtimeSurface).toSorted()).toEqual([
      'PipelineCompileResultSchema',
      'PipelineProgramSchema',
      'PipelineSourcePackageSchema',
      'ProfileMaterializationSchema',
      'ProgramDigestInputSchema',
      'ProgramProvenanceSchema',
      'ProgramRequirementsSchema',
      'ValueSchemaSchema',
      'compilePipeline',
      'computeMaterializationDigest',
      'computeProgramDigest',
      'computeSourceDigest',
      'definePipelineSource',
      'defineProfileMaterialization',
    ]);
    expect(Object.keys(kernelSurface).toSorted()).toEqual([
      'InitialPipelineTransitionSchema',
      'KernelProgramSchema',
      'PipelineCommandSchema',
      'PipelineEventSchema',
      'PipelineProgramSchema',
      'PipelineStateSchema',
      'PipelineTransitionSchema',
      'advancePipeline',
      'createInitialPipelineState',
    ]);
    expect(runtimeSurface.PipelineProgramSchema).toBe(kernelSurface.PipelineProgramSchema);
  });
});
