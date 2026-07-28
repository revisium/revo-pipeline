import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { validatePackageVerifierFlow } from '../../../scripts/architecture/validate-package-verifier-flow.js';

const FILES = [
  'scripts/verify-package.ts',
  'scripts/package/package-consumer-catalog.ts',
  'scripts/package/package-documentation-examples.ts',
  'scripts/package/package-command-runner.ts',
  'scripts/package/package-artifact-tree.ts',
  'scripts/package/package-type-closure.ts',
  'scripts/package/package-consumer-fixtures.ts',
  'scripts/architecture/validate-module-structure.ts',
] as const;

type Candidate = Record<(typeof FILES)[number], string>;

const candidate = async (): Promise<Candidate> => {
  const [verifier, catalog, documentation, runner, tree, closure, fixtures, moduleStructure] =
    await Promise.all(FILES.map((path) => readFile(join(process.cwd(), path), 'utf8')));
  return {
    'scripts/verify-package.ts': verifier ?? '',
    'scripts/package/package-consumer-catalog.ts': catalog ?? '',
    'scripts/package/package-documentation-examples.ts': documentation ?? '',
    'scripts/package/package-command-runner.ts': runner ?? '',
    'scripts/package/package-artifact-tree.ts': tree ?? '',
    'scripts/package/package-type-closure.ts': closure ?? '',
    'scripts/package/package-consumer-fixtures.ts': fixtures ?? '',
    'scripts/architecture/validate-module-structure.ts': moduleStructure ?? '',
  };
};

const validateCandidate = async (
  sources: Candidate,
  retiredReader = false,
  extraPackageFile?: string,
): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), 'package-flow-'));
  try {
    await Promise.all(
      Object.entries(sources).map(async ([path, source]) => {
        await mkdir(join(root, path, '..'), { recursive: true });
        await writeFile(join(root, path), source);
      }),
    );
    if (retiredReader) {
      await writeFile(join(root, 'scripts/package/package-artifact-reader.ts'), 'export {};\n');
    }
    if (extraPackageFile) {
      await writeFile(join(root, 'scripts/package', extraPackageFile), 'export {};\n');
    }
    validatePackageVerifierFlow(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

const replaceOnce = (source: string, current: string, replacement: string): string => {
  expect(source.split(current)).toHaveLength(2);
  return source.replace(current, replacement);
};

test('accepts the exact A3.1 module DAG and direct lifecycle', () => {
  expect(() => validatePackageVerifierFlow(process.cwd())).not.toThrow();
});

test('rejects the retired reader and a second filesystem boundary', async () => {
  const sources = await candidate();
  await expect(validateCandidate(sources, true)).rejects.toThrow('[package-reader-boundary]');
  await expect(
    validateCandidate({
      ...sources,
      'scripts/package/package-command-runner.ts': `import { readFileSync } from 'node:fs';\n${sources['scripts/package/package-command-runner.ts']}`,
    }),
  ).rejects.toThrow('[package-tree-boundary]');
});

test('rejects exported reader construction and fixture text in the verifier', async () => {
  const sources = await candidate();
  await expect(
    validateCandidate({
      ...sources,
      'scripts/package/package-command-runner.ts': `${sources['scripts/package/package-command-runner.ts']}\nexport class PackageArtifactReader {}`,
    }),
  ).rejects.toThrow('[package-reader-boundary]');
  await expect(
    validateCandidate({
      ...sources,
      'scripts/verify-package.ts': `${sources['scripts/verify-package.ts']}\nconst definition = definePipeline({});`,
    }),
  ).rejects.toThrow('[package-fixture-boundary]');
});

test('rejects every eighth package leaf, cross-boundary import, and parallel inventory', async () => {
  const sources = await candidate();
  await expect(validateCandidate(sources, false, 'package-extra.ts')).rejects.toThrow(
    '[package-verifier-flow-unproven]',
  );
  await expect(
    validateCandidate({
      ...sources,
      'scripts/package/package-consumer-fixtures.ts': `import { PACKAGE_CONSUMER_CASES } from './package-consumer-catalog.js';\n${sources['scripts/package/package-consumer-fixtures.ts']}`,
    }),
  ).rejects.toThrow('[package-verifier-flow-unproven]');
  await expect(
    validateCandidate({
      ...sources,
      'scripts/package/package-consumer-fixtures.ts': `${sources['scripts/package/package-consumer-fixtures.ts']}\nconst CONSUMER_FIXTURE_DESCRIPTORS = [];`,
    }),
  ).rejects.toThrow('[package-catalog-boundary]');
  await expect(
    validateCandidate({
      ...sources,
      'scripts/package/package-artifact-tree.ts': `${sources['scripts/package/package-artifact-tree.ts']}\nconst mutateExhaustivenessDeclaration = true;`,
    }),
  ).rejects.toThrow('[package-catalog-boundary]');
});

test.each([
  `import catalog from "./package-consumer-catalog.js";`,
  `import {\n  PACKAGE_CONSUMER_CASES,\n} from "./package-consumer-catalog.js";`,
  `import * as catalog from './package-consumer-catalog.js';`,
  `import './package-consumer-catalog.js';`,
  `import type { ConsumerCase } from "./package-consumer-catalog.js";`,
  `import catalog = require('./package-consumer-catalog.js');`,
  `type Catalog = import("./package-consumer-catalog.js");`,
  `export { PACKAGE_CONSUMER_CASES } from './package-consumer-catalog.js';`,
  `export * from "./package-consumer-catalog.js";`,
  `void import('./package-consumer-catalog.js');`,
  `void require("./package-consumer-catalog.js");`,
  `void module.require('./package-consumer-catalog.js');`,
] as const)('rejects unapproved local module loading syntax %#', async (loading) => {
  const sources = await candidate();
  await expect(
    validateCandidate({
      ...sources,
      'scripts/package/package-consumer-fixtures.ts': `${loading}\n${sources['scripts/package/package-consumer-fixtures.ts']}`,
    }),
  ).rejects.toThrow('[package-verifier-flow-unproven]');
});

test.each([
  'reader.typeCaseId(fixture)',
  'reader.prepareTypeScript(fixture)',
  'reader.restoreTypeScript(prepared)',
  'reader.runtimeCaseId(fixture)',
  'reader.runtimeLaunch(fixture)',
] as const)('rejects lifecycle proof mutation %s', async (fragment) => {
  const sources = await candidate();
  await expect(
    validateCandidate({
      ...sources,
      'scripts/package/package-command-runner.ts': replaceOnce(
        sources['scripts/package/package-command-runner.ts'],
        fragment,
        '/* lifecycle proof removed */',
      ),
    }),
  ).rejects.toThrow('[package-consumer-lifecycle]');
});

test('rejects missing, conditional, and path-bearing cleanup', async () => {
  const sources = await candidate();
  await Promise.all(
    ['', 'if (primaryError) runner.dispose();', "runner.dispose('/tmp');"].map(
      async (replacement) =>
        expect(
          validateCandidate({
            ...sources,
            'scripts/verify-package.ts': replaceOnce(
              sources['scripts/verify-package.ts'],
              'runner.dispose();',
              replacement,
            ),
          }),
        ).rejects.toThrow('[package-cleanup-flow]'),
    ),
  );
});

test('rejects broadened runtime flags and pack multiplicity', async () => {
  const sources = await candidate();
  await expect(
    validateCandidate({
      ...sources,
      'scripts/package/package-command-runner.ts': replaceOnce(
        sources['scripts/package/package-command-runner.ts'],
        "arguments: ['--permission', `--allow-fs-read=${tree.root}`, launch.entrypoint]",
        "arguments: ['--permission', '--allow-fs-write=*', launch.entrypoint]",
      ),
    }),
  ).rejects.toThrow('[package-runtime-permission]');
  await expect(
    validateCandidate({
      ...sources,
      'scripts/verify-package.ts': replaceOnce(
        sources['scripts/verify-package.ts'],
        'artifact = runner.pack();',
        'artifact = runner.pack();\n    runner.pack();',
      ),
    }),
  ).rejects.toThrow('[package-pack-multiplicity]');
});

test.each([
  [
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, launch.entrypoint]",
    'arguments: [`--allow-fs-read=${tree.root}`, launch.entrypoint]',
  ],
  [
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, launch.entrypoint]",
    "arguments: ['--permission', '--allow-fs-read=*', launch.entrypoint]",
  ],
  [
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, launch.entrypoint]",
    "arguments: ['--permission', `--allow-fs-read=${tree.root}/..`, launch.entrypoint]",
  ],
  [
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, launch.entrypoint]",
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, '--allow-fs-write=*', launch.entrypoint]",
  ],
  [
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, launch.entrypoint]",
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, '--allow-child-process', launch.entrypoint]",
  ],
  [
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, launch.entrypoint]",
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, '--allow-worker', launch.entrypoint]",
  ],
  [
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, launch.entrypoint]",
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, '--allow-addons', launch.entrypoint]",
  ],
  [
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, launch.entrypoint]",
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, '--allow-wasi', launch.entrypoint]",
  ],
  ['environment: {}', "environment: { NODE_OPTIONS: '--import=evil' }"],
  ['cwd: launch.cwd', 'cwd: tree.workspaceRoot'],
  ["stdio: ['ignore', 'pipe', 'pipe']", "stdio: 'inherit'"],
] as const)(
  'rejects permission/environment/descriptor mutation %#',
  async (current, replacement) => {
    const sources = await candidate();
    await expect(
      validateCandidate({
        ...sources,
        'scripts/package/package-command-runner.ts': replaceOnce(
          sources['scripts/package/package-command-runner.ts'],
          current,
          replacement,
        ),
      }),
    ).rejects.toThrow('[package-runtime-permission]');
  },
);

test.each([
  [
    'runner alias',
    'artifact = runner.pack();',
    'const alias = runner;\n    artifact = runner.pack();',
  ],
  [
    'access alias',
    'access = runner.prepareArtifact(packedArtifact);',
    'access = runner.prepareArtifact(packedArtifact);\n    const alias = access;',
  ],
  [
    'runner helper escape',
    'artifact = runner.pack();',
    'helper(runner);\n    artifact = runner.pack();',
  ],
  [
    'access helper escape',
    'runner.assertComplete(preparedAccess);',
    'helper(preparedAccess);\n    runner.assertComplete(preparedAccess);',
  ],
] as const)('rejects constrained direct-flow %s', async (_label, current, replacement) => {
  const sources = await candidate();
  await expect(
    validateCandidate({
      ...sources,
      'scripts/verify-package.ts': replaceOnce(
        sources['scripts/verify-package.ts'],
        current,
        replacement,
      ),
    }),
  ).rejects.toThrow('[package-verifier-flow-unproven]');
});
