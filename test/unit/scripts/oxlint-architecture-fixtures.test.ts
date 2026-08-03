import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import fixtures from '../../fixtures/oxlint-architecture.json' with { type: 'json' };

const root = process.cwd();
const oxlint = join(root, 'node_modules/.bin/oxlint');
const config = join(root, '.oxlintrc.json');
const typeScript = join(root, 'node_modules/.bin/tsc');
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null;
const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const lint = (directory: string, files: readonly string[]): string => {
  try {
    execFileSync(oxlint, ['--config', config, '--deny-warnings', ...files], {
      cwd: directory,
      stdio: 'pipe',
    });
    return '';
  } catch (error: unknown) {
    return error instanceof Error && 'stdout' in error && Buffer.isBuffer(error.stdout)
      ? error.stdout.toString('utf8')
      : String(error);
  }
};

const inTemporaryProject = (path: 'src' | 'test', source: string): string => {
  const directory = mkdtempSync(join(tmpdir(), 'revo-pipeline-oxlint-'));
  try {
    mkdirSync(join(directory, path));
    writeFileSync(join(directory, path, 'fixture.ts'), source);
    writeFileSync(
      join(directory, path, 'dependency.ts'),
      'export const value = true; export type Value = true;',
    );
    return lint(directory, [`${path}/fixture.ts`, `${path}/dependency.ts`]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test.each(Object.entries(fixtures.forbidden))(
  'committed test override rejects forbidden host %s imports',
  (_name, source) => {
    expect(inTemporaryProject('test', source)).toContain('no-restricted-imports');
  },
);

test.each(Object.entries(fixtures.missingExtensions))(
  'committed Oxlint rejects extensionless %s imports',
  (_name, source) => {
    expect(inTemporaryProject('src', source)).toContain('import(extensions)');
  },
);

test.each(Object.entries(fixtures.acceptedExtensions))(
  'committed Oxlint accepts explicit .js %s imports',
  (_name, source) => {
    expect(inTemporaryProject('src', source)).toBe('');
  },
);

const callable = (lines: number): string =>
  ['export function bounded() {', ...Array.from({ length: lines - 2 }, () => 'void 0;'), '}'].join(
    '\n',
  );

test('committed production override has exact options and distinguishes 80/81 lines', () => {
  const parsed: unknown = JSON.parse(readFileSync(config, 'utf8'));
  if (!isRecord(parsed) || !isUnknownArray(parsed['overrides'])) {
    throw new Error('[oxlint-production-override]');
  }
  const production = parsed['overrides'].find(
    (override: unknown) =>
      isRecord(override) &&
      isUnknownArray(override['files']) &&
      override['files'].includes('**/src/**/*.ts'),
  );
  if (!isRecord(production) || !isRecord(production['rules'])) {
    throw new Error('[oxlint-production-override]');
  }
  expect(production['rules']['max-lines-per-function']).toEqual([
    'error',
    { max: 80, skipBlankLines: false, skipComments: false, IIFEs: true },
  ]);
  expect(inTemporaryProject('src', callable(80))).toBe('');
  expect(inTemporaryProject('src', callable(81))).toContain('max-lines-per-function');
});

const compile = (source: string): { status: number; output: string } => {
  const directory = mkdtempSync(join(tmpdir(), 'revo-pipeline-typescript-'));
  try {
    mkdirSync(join(directory, 'src'));
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(join(directory, 'src/fixture.ts'), source);
    writeFileSync(
      join(directory, 'src/dependency.ts'),
      'export const value = true; export type Value = true;',
    );
    writeFileSync(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        extends: join(root, 'tsconfig.json'),
        compilerOptions: { noEmit: true, types: [] },
        files: ['src/fixture.ts', 'src/dependency.ts'],
      }),
    );
    const result = spawnSync(typeScript, ['-p', 'tsconfig.json'], {
      cwd: directory,
      encoding: 'utf8',
    });
    if (result.error) {
      throw result.error;
    }
    return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test.each([
  ['literal dynamic import', fixtures.typescriptExtensions.extensionlessDynamic],
  ['import type expression', fixtures.typescriptExtensions.extensionlessImportType],
])('project TypeScript rejects extensionless %s', (_name, source) => {
  const result = compile(source);
  expect(result.status).toBe(1);
  expect(result.output).toContain('TS2835');
});

test.each([
  ['literal dynamic import', fixtures.typescriptExtensions.explicitDynamic],
  ['import type expression', fixtures.typescriptExtensions.explicitImportType],
])('project TypeScript accepts explicit .js %s', (_name, source) => {
  const result = compile(source);
  expect(result.status).toBe(0);
  expect(result.output).toBe('');
});
