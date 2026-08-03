import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ListedTest = { readonly file: string; readonly name: string };
export type ListingDependencies = {
  readonly createDirectory: () => string;
  readonly spawn: (listing: string) => SpawnSyncReturns<string>;
  readonly read: (listing: string) => string;
  readonly cleanup: (directory: string) => void;
};

const isListedTest = (value: unknown): value is ListedTest =>
  typeof value === 'object' &&
  value !== null &&
  'file' in value &&
  typeof value.file === 'string' &&
  'name' in value &&
  typeof value.name === 'string' &&
  value.name.length > 0;

export const listingDependencies = (
  root: string,
  vitest: string,
  config: string,
): ListingDependencies => ({
  createDirectory: () => mkdtempSync(join(tmpdir(), 'revo-pipeline-test-routing-')),
  spawn: (listing) =>
    spawnSync(process.execPath, [vitest, 'list', '--config', config, '--json', listing], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'pipe'],
    }),
  read: (listing) => readFileSync(listing, 'utf8'),
  cleanup: (directory) => rmSync(directory, { recursive: true, force: true }),
});

export const readTestListing = (
  config: string,
  dependencies: ListingDependencies,
): readonly ListedTest[] => {
  const directory = dependencies.createDirectory();
  const listing = join(directory, 'listing.json');
  try {
    const result = dependencies.spawn(listing);
    if (result.error) {
      throw new Error(`${config} discovery could not start: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(
        `${config} discovery exited ${String(result.status)}: ${result.stderr.trim() || 'no stderr'}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(dependencies.read(listing));
    } catch {
      throw new Error(`${config} discovery did not emit JSON`);
    }
    if (!Array.isArray(parsed) || !parsed.every(isListedTest)) {
      throw new Error(`${config} discovery emitted an unexpected schema`);
    }
    return parsed;
  } finally {
    dependencies.cleanup(directory);
  }
};
