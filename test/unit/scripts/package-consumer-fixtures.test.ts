import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  CONSUMER_FIXTURE_DESCRIPTORS,
  HOST_SHAPED_CONSUMER_SOURCE,
  TYPE_CONSUMER_SOURCE,
  permissionFixtureSource,
} from '../../../scripts/package/package-consumer-fixtures.js';

test('publishes the exact unique deeply frozen fixture descriptor set', () => {
  expect(CONSUMER_FIXTURE_DESCRIPTORS.map(({ id }) => id)).toEqual([
    'runtime',
    'private-runtime',
    'positive',
    'private',
    'default',
    'alias',
    'subpath',
    'host-shaped',
    'readme-example',
    'expanded-example',
    'decision-growth',
    'reduction-growth',
    'permission-read',
    'permission-write',
    'permission-child',
    'permission-worker',
  ]);
  expect(new Set(CONSUMER_FIXTURE_DESCRIPTORS.map(({ id }) => id)).size).toBe(
    CONSUMER_FIXTURE_DESCRIPTORS.length,
  );
  expect(Object.isFrozen(CONSUMER_FIXTURE_DESCRIPTORS)).toBe(true);
  expect(CONSUMER_FIXTURE_DESCRIPTORS.every(Object.isFrozen)).toBe(true);
});

test('retains both live whole-union exhaustiveness calls', () => {
  for (const source of [TYPE_CONSUMER_SOURCE, HOST_SHAPED_CONSUMER_SOURCE]) {
    expect(source).toContain('assertNever(decision);');
    expect(source).toContain('assertNever(reduction);');
  }
});

test('builds only the four ordinary permission regression fixtures', () => {
  expect(permissionFixtureSource('permission-read')).toContain('FileSystemRead');
  expect(permissionFixtureSource('permission-write')).toContain('FileSystemWrite');
  expect(permissionFixtureSource('permission-child')).toContain('ChildProcess');
  expect(permissionFixtureSource('permission-worker')).toContain('WorkerThreads');
});

test('imports no side-effecting repository or system module', async () => {
  const source = await readFile(
    join(process.cwd(), 'scripts/package/package-consumer-fixtures.ts'),
    'utf8',
  );
  expect(source).not.toMatch(/^import [^{`]/u);
});
