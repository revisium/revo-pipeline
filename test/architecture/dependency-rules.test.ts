import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtureRoot = join(repositoryRoot, 'test', 'architecture', 'fixtures');
const dependencyCruiser = join(
  repositoryRoot,
  'node_modules',
  'dependency-cruiser',
  'bin',
  'dependency-cruise.mjs',
);
const configuration = join(repositoryRoot, '.dependency-cruiser.cjs');
const temporaryRoots: string[] = [];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readViolationNames = (output: string): string[] => {
  const result: unknown = JSON.parse(output);
  if (!isRecord(result) || !isRecord(result.summary) || !Array.isArray(result.summary.violations)) {
    throw new Error('dependency-cruiser output has an unexpected shape');
  }
  return result.summary.violations.map((violation: unknown) => {
    if (
      !isRecord(violation) ||
      !isRecord(violation.rule) ||
      typeof violation.rule.name !== 'string'
    ) {
      throw new Error('dependency-cruiser violation has an unexpected shape');
    }
    return violation.rule.name;
  });
};

const materializeDirectory = (source: string, destination: string): void => {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    if (entry.isDirectory()) {
      materializeDirectory(sourcePath, join(destination, entry.name));
    } else {
      const name = entry.name.endsWith('.txt') ? entry.name.slice(0, -4) : entry.name;
      writeFileSync(join(destination, name), readFileSync(sourcePath));
    }
  }
};

const cruiseFixture = (name: string) => {
  const root = mkdtempSync(join(tmpdir(), 'revo-pipeline-dependencies-'));
  temporaryRoots.push(root);
  materializeDirectory(join(fixtureRoot, name), root);
  writeFileSync(join(root, 'package.json'), readFileSync(join(repositoryRoot, 'package.json')));
  writeFileSync(
    join(root, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' } })}\n`,
  );
  mkdirSync(join(root, 'node_modules'));
  symlinkSync(
    realpathSync(join(repositoryRoot, 'node_modules', 'canonicalize')),
    join(root, 'node_modules', 'canonicalize'),
    'dir',
  );
  symlinkSync(
    realpathSync(join(dirname(realpathSync(dependencyCruiser)), '..', '..', 'typescript')),
    join(root, 'node_modules', 'typescript'),
    'dir',
  );
  return spawnSync(
    process.execPath,
    [dependencyCruiser, '--config', configuration, '--output-type', 'json', 'src'],
    { cwd: root, encoding: 'utf8' },
  );
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('manifest-derived dependency rules', () => {
  it.each([
    ['cross-layer-deep', 'cross-layer-foundation-imports-use-index'],
    ['disallowed-layer', 'source-uses-declared-layer-dependencies'],
    ['root-import', 'layers-do-not-import-root-module'],
    ['root-private-import', 'root-module-has-no-imports'],
    ['unresolved-local', 'source-imports-must-resolve'],
    ['cycle', 'no-cycles'],
    ['forbidden-builtin', 'source-uses-only-node-crypto'],
    ['forbidden-external-typescript', 'production-source-no-nonproduction-dependencies'],
  ])('rejects the %s representative fixture', (fixture, rule) => {
    const result = cruiseFixture(fixture);
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readViolationNames(result.stdout)).toContain(rule);
  });

  it.each(['allowed-index', 'allowed-peer', 'allowed-node-crypto', 'allowed-canonicalize'])(
    'accepts the %s representative fixture',
    (fixture) => {
      const result = cruiseFixture(fixture);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(readViolationNames(result.stdout)).toEqual([]);
    },
  );
});
