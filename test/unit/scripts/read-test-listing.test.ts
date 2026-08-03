import type { SpawnSyncReturns } from 'node:child_process';

import { expect, test } from 'vitest';

import {
  readTestListing,
  type ListingDependencies,
} from '../../../scripts/test/read-test-listing.js';

const result = (status: number | null, stderr = '', error?: Error): SpawnSyncReturns<string> => ({
  pid: 1,
  output: [null, '', stderr],
  stdout: '',
  stderr,
  status,
  signal: null,
  ...(error ? { error } : {}),
});
const dependencies = (
  overrides: Partial<ListingDependencies> = {},
): { readonly value: ListingDependencies; readonly cleaned: string[] } => {
  const cleaned: string[] = [];
  return {
    cleaned,
    value: {
      createDirectory: () => '/tmp/test-routing-a',
      spawn: () => result(0),
      read: () => '[{"file":"test/a.test.ts","name":"works"}]',
      cleanup: (directory) => cleaned.push(directory),
      ...overrides,
    },
  };
};

test('preserves child start failures and nonzero status stderr', () => {
  const start = dependencies({ spawn: () => result(null, '', new Error('spawn denied')) });
  expect(() => readTestListing('route.ts', start.value)).toThrowError(
    'route.ts discovery could not start: spawn denied',
  );
  const exited = dependencies({ spawn: () => result(7, 'specific stderr') });
  expect(() => readTestListing('route.ts', exited.value)).toThrowError(
    'route.ts discovery exited 7: specific stderr',
  );
});

test.each(['', '{bad', '{}'])(
  'rejects missing, malformed, or invalid listing JSON: %s',
  (source) => {
    const fixture = dependencies({ read: () => source });
    const expected = source === '{}' ? 'unexpected schema' : 'did not emit JSON';
    expect(() => readTestListing('route.ts', fixture.value)).toThrowError(expected);
  },
);

test('uses isolated listing paths across concurrent calls', async () => {
  let next = 0;
  const paths: string[] = [];
  const fixture = dependencies({
    createDirectory: () => `/tmp/test-routing-${String(++next)}`,
    spawn: (listing) => {
      paths.push(listing);
      return result(0);
    },
  });
  await Promise.all([
    Promise.resolve().then(() => readTestListing('a.ts', fixture.value)),
    Promise.resolve().then(() => readTestListing('b.ts', fixture.value)),
  ]);
  expect(new Set(paths).size).toBe(2);
});

test('cleans the isolated directory after success and every failure', () => {
  const success = dependencies();
  readTestListing('route.ts', success.value);
  expect(success.cleaned).toEqual(['/tmp/test-routing-a']);
  const failure = dependencies({ read: () => 'bad' });
  expect(() => readTestListing('route.ts', failure.value)).toThrow('did not emit JSON');
  expect(failure.cleaned).toEqual(['/tmp/test-routing-a']);
});
