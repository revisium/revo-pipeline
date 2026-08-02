import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  HOST_SHAPED_CONSUMER_SOURCE,
  RUNTIME_CONSUMER_SOURCE,
  TYPE_CONSUMER_SOURCE,
  permissionFixtureSource,
} from '../../../scripts/package/package-consumer-fixtures.js';

test('retains both live whole-union exhaustiveness calls', () => {
  for (const source of [TYPE_CONSUMER_SOURCE, HOST_SHAPED_CONSUMER_SOURCE]) {
    expect(source).toContain('assertNever(decision);');
    expect(source).toContain('assertNever(reduction);');
  }
});

test('pins script authoring and all six script template types in isolated root consumers', () => {
  expect(RUNTIME_CONSUMER_SOURCE).toContain("kind: 'script'");
  expect(RUNTIME_CONSUMER_SOURCE).toContain(
    'assert.equal(scriptCompilation.template.pipeline, scriptCompilation.pipeline);',
  );
  for (const typeName of [
    'JsonValue',
    'ScriptIdentity',
    'ScriptNode',
    'ExecutorRequirement',
    'TerminalBindingTemplate',
    'PipelineExecutionTemplate',
  ]) {
    expect(TYPE_CONSUMER_SOURCE).toContain(`type ${typeName}`);
  }
  expect(TYPE_CONSUMER_SOURCE).toContain('const publicTypeCount: 92');
  expect(TYPE_CONSUMER_SOURCE).not.toContain('@revisium/revo-pipeline/');
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
