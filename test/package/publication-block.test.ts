import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as runtimeSurface from '../../src/index.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const verificationScript = fileURLToPath(
  new URL('../../scripts/verify-publication-block.mjs', import.meta.url),
);

describe('publication block', () => {
  it('validates the blocked package manifest and reset source state', () => {
    const result = spawnSync(process.execPath, [verificationScript, '--verify'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Publication block verified.');
  });

  it('fails closed when invoked as the publish hook', () => {
    const result = spawnSync(process.execPath, [verificationScript], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Publication is blocked until rp-06');
  });

  it('has no runtime exports during the reset', () => {
    expect(Object.keys(runtimeSurface)).toEqual([]);
  });
});
