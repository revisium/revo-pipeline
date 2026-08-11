import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as runtimeSurface from '../../src/index.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const packageJson: unknown = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

describe('publication block', () => {
  it('validates the blocked package manifest', () => {
    expect(isRecord(packageJson)).toBe(true);
    if (!isRecord(packageJson)) {
      return;
    }

    expect(packageJson.private).toBe(true);
    expect(packageJson.type).toBe('module');
    expect(packageJson.dependencies).toEqual({ canonicalize: '3.0.0', typebox: '1.3.10' });
    for (const field of [
      'main',
      'types',
      'exports',
      'files',
      'publishConfig',
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
    expect(packageJson.scripts.prepublishOnly).toBe(
      `node -e "console.error('Publication is blocked until conformance and readiness are complete.'); process.exit(1)"`,
    );
    expect(Object.hasOwn(packageJson.scripts, 'prepack')).toBe(false);
  });

  it('fails closed when invoked as the publish hook', () => {
    const result = spawnSync('corepack', ['pnpm', 'run', 'prepublishOnly'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'Publication is blocked until conformance and readiness are complete.',
    );
  });

  it('keeps the reviewed CI workflow as the only workflow', () => {
    expect(readdirSync(join(repositoryRoot, '.github', 'workflows'))).toEqual(['ci.yml']);
  });

  it('has no root runtime exports while the package is private', () => {
    expect(Object.keys(runtimeSurface)).toEqual([]);
  });
});
