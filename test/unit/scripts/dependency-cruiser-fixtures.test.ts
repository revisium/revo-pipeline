import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, test } from 'vitest';

import fixtures from '../../fixtures/dependency-cruiser.json' with { type: 'json' };

const cruise = (files: Readonly<Record<string, string>>): { status: number; output: string } => {
  const root = mkdtempSync(join(tmpdir(), 'revo-pipeline-depcruise-'));
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'test'));
    for (const [path, source] of Object.entries(files)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source);
    }
    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' } }),
    );
    const result = spawnSync(
      join(process.cwd(), 'node_modules/.bin/depcruise'),
      ['--config', join(process.cwd(), '.dependency-cruiser.cjs'), 'src', 'test'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
    );
    if (result.error) {
      throw result.error;
    }
    return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test.each(fixtures)('$name', ({ files, expectedRule }) => {
  const { status, output } = cruise(files);
  const counts = /(\d+) modules, (\d+) dependencies cruised/u.exec(output);
  expect(Number(counts?.[1] ?? 0)).toBeGreaterThan(0);
  expect(Number(counts?.[2] ?? 0)).toBeGreaterThan(0);
  expect(status).toBe(Number(expectedRule !== null));
  expect(output).toContain(expectedRule ?? 'no dependency violations found');
});
