import { readdir, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import { listingDependencies, readTestListing, type ListedTest } from './test/read-test-listing.js';
import { TEST_ROUTE_CHECKPOINT } from './test/test-suite-routes.js';

type RouteInventory = {
  readonly files: ReadonlySet<string>;
  readonly tests: number;
};

const root = resolve(import.meta.dirname, '..');
const vitest = resolve(root, 'node_modules/vitest/vitest.mjs');

const fail = (message: string): never => {
  throw new Error(`Test routing verification failed: ${message}`);
};

const canonicalPath = (path: string): string => {
  const repositoryPath = relative(root, resolve(path));
  if (
    repositoryPath === '' ||
    repositoryPath === '..' ||
    repositoryPath.startsWith(`..${sep}`) ||
    repositoryPath.includes('\0')
  ) {
    return fail(`path escapes repository: ${path}`);
  }
  return repositoryPath.split(sep).join('/');
};

const parseListing = (config: string): readonly ListedTest[] => {
  try {
    return readTestListing(config, listingDependencies(root, vitest, config));
  } catch (error: unknown) {
    return fail(error instanceof Error ? error.message : String(error));
  }
};

const routeInventory = (config: string): RouteInventory => {
  const files = new Set<string>();
  const tests = parseListing(config);
  for (const test of tests) {
    const file = canonicalPath(test.file);
    if (!file.startsWith('test/') || !file.endsWith('.test.ts')) {
      fail(`${config} discovered an invalid test path: ${file}`);
    }
    files.add(file);
  }
  return { files, tests: tests.length };
};

const collectTestFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(`symbolic link is not allowed in test inventory: ${canonicalPath(path)}`);
      }
      if (entry.isDirectory()) {
        return collectTestFiles(path);
      }
      if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        return [canonicalPath(await realpath(path))];
      }
      return [];
    }),
  );
  return nestedFiles.flat().sort();
};

const assertCheckpoint = (
  route: string,
  inventory: RouteInventory,
  checkpoint: { readonly files: number; readonly tests: number },
): void => {
  if (inventory.files.size !== checkpoint.files || inventory.tests !== checkpoint.tests) {
    fail(
      `${route} checkpoint drifted: expected ${String(checkpoint.files)} files/${String(checkpoint.tests)} tests, got ${String(inventory.files.size)} files/${String(inventory.tests)} tests`,
    );
  }
};

const coverage = routeInventory('vitest.coverage.config.ts');
const harness = routeInventory('vitest.harness.config.ts');
const overlap = [...coverage.files].filter((file) => harness.files.has(file));
if (overlap.length > 0) {
  fail(`routes overlap: ${overlap.join(', ')}`);
}

const filesystemFiles = await collectTestFiles(resolve(root, 'test'));
const discoveredFiles = [...coverage.files, ...harness.files].sort();
if (JSON.stringify(discoveredFiles) !== JSON.stringify(filesystemFiles)) {
  const missing = filesystemFiles.filter((file) => !discoveredFiles.includes(file));
  const unexpected = discoveredFiles.filter((file) => !filesystemFiles.includes(file));
  fail(
    `route union mismatch; missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}]`,
  );
}

assertCheckpoint('coverage', coverage, TEST_ROUTE_CHECKPOINT.coverage);
assertCheckpoint('harness', harness, TEST_ROUTE_CHECKPOINT.harness);
if (
  discoveredFiles.length !== TEST_ROUTE_CHECKPOINT.total.files ||
  coverage.tests + harness.tests !== TEST_ROUTE_CHECKPOINT.total.tests
) {
  fail(
    `total checkpoint drifted: expected ${String(TEST_ROUTE_CHECKPOINT.total.files)} files/${String(TEST_ROUTE_CHECKPOINT.total.tests)} tests, got ${String(discoveredFiles.length)} files/${String(coverage.tests + harness.tests)} tests`,
  );
}

console.log(
  `Test routing verified: coverage ${String(coverage.files.size)} files/${String(coverage.tests)} tests; harness ${String(harness.files.size)} files/${String(harness.tests)} tests; total ${String(discoveredFiles.length)} files/${String(coverage.tests + harness.tests)} tests.`,
);
