import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  createPackageArtifactTreeForTest,
  type PackageArtifactTree,
  type PackageArtifactTreeRegistration,
} from '../../../scripts/package/package-artifact-tree.js';
import {
  createPackageCommandRunnerForTest,
  type PackageArtifact,
  type PackageCommandExecutor,
} from '../../../scripts/package/package-command-runner.js';

const packOutput = JSON.stringify([{ filename: 'revisium-revo-pipeline-0.0.0.tgz', files: [] }]);

const extractedFixture = (command: Parameters<PackageCommandExecutor>[1]): void => {
  const destination = command.arguments[command.arguments.indexOf('-C') + 1];
  if (!destination) {
    throw new Error('missing extraction destination');
  }
  mkdirSync(join(destination, 'dist/spec'), { recursive: true });
  writeFileSync(
    join(destination, 'package.json'),
    JSON.stringify({
      name: '@revisium/revo-pipeline',
      type: 'module',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    }),
  );
  writeFileSync(join(destination, 'dist/index.d.ts'), 'export declare const value: true;\n');
  writeFileSync(join(destination, 'dist/index.js'), 'export const value = true;\n');
  writeFileSync(
    join(destination, 'dist/spec/pipeline-occurrence-key.d.ts'),
    'export type PipelineOccurrenceKey = string;\n',
  );
};

interface Harness {
  readonly registration: PackageArtifactTreeRegistration;
  readonly tree: PackageArtifactTree;
  readonly commands: Parameters<PackageCommandExecutor>[0][];
  readonly details: Parameters<PackageCommandExecutor>[1][];
  readonly removals: string[];
  readonly executor: PackageCommandExecutor;
}

const createHarness = (): Harness => {
  const commands: Parameters<PackageCommandExecutor>[0][] = [];
  const details: Parameters<PackageCommandExecutor>[1][] = [];
  const removals: string[] = [];
  const registration = createPackageArtifactTreeForTest(process.cwd(), (path) => {
    removals.push(path);
    rmSync(path, { recursive: true, force: true });
  });
  const { tree } = registration;
  return {
    registration,
    tree,
    commands,
    details,
    removals,
    executor(capability, command) {
      commands.push(capability);
      details.push(command);
      if (capability === 'extract') {
        extractedFixture(command);
      }
      return capability === 'pack' ? packOutput : '';
    },
  };
};

test('runs one artifact through extract, prepare, use, complete, and dispose', () => {
  const harness = createHarness();
  const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration);
  const artifact = runner.pack();
  runner.publint(artifact);
  runner.attw(artifact);
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  const typeFixture = access.createTypeConsumer('positive', 'export {};\n');
  const runtimeFixture = access.createRuntimeConsumer('runtime', 'export {};\n');
  runner.typeScript(access, typeFixture);
  runner.executeConsumer(access, runtimeFixture);
  runner.assertComplete(access);
  runner.dispose();
  runner.dispose();
  expect(harness.commands).toEqual([
    'pack',
    'publint',
    'attw',
    'extract',
    'typeScript',
    'consumer',
  ]);
  expect(harness.removals).toHaveLength(1);
  expect(harness.details.at(-1)).toMatchObject({
    executable: process.execPath,
    arguments: [
      '--permission',
      `--allow-fs-read=${harness.tree.root}`,
      join(harness.tree.root, 'consumer.mjs'),
    ],
    cwd: harness.tree.root,
    environment: {},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
});

test('rejects second and failed-then-retried pack before another command', () => {
  const first = createHarness();
  const runner = createPackageCommandRunnerForTest(first.executor, first.registration);
  runner.pack();
  expect(() => runner.pack()).toThrow('[package-pack-multiplicity]');
  runner.dispose();

  const failed = createHarness();
  const failedRunner = createPackageCommandRunnerForTest(() => {
    throw new Error('pack failed');
  }, failed.registration);
  expect(() => failedRunner.pack()).toThrow('pack failed');
  expect(() => failedRunner.pack()).toThrow('[package-pack-multiplicity]');
  failedRunner.dispose();
});

test('rejects prepare ordering, artifact copies, and foreign access', () => {
  const first = createHarness();
  const runner = createPackageCommandRunnerForTest(first.executor, first.registration);
  const artifact = runner.pack();
  expect(() => runner.prepareArtifact(artifact)).toThrow('[package-artifact-identity]');
  const copy: PackageArtifact = { ...artifact };
  expect(() => runner.extract(copy)).toThrow('[package-artifact-identity]');
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  expect(() => runner.prepareArtifact(artifact)).toThrow('[package-artifact-identity]');
  expect(() =>
    runner.executeConsumer({ ...access }, access.createRuntimeConsumer('runtime', 'export {};\n')),
  ).toThrow('[package-artifact-identity]');

  const second = createHarness();
  const foreign = createPackageCommandRunnerForTest(second.executor, second.registration);
  expect(() =>
    foreign.executeConsumer(access, access.createRuntimeConsumer('runtime', 'export {};\n')),
  ).toThrow('[package-artifact-identity]');
  runner.dispose();
  foreign.dispose();
});

test('closes every capability after completion while preserving disposal', () => {
  const harness = createHarness();
  const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration);
  const artifact = runner.pack();
  runner.publint(artifact);
  runner.attw(artifact);
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  const typeFixture = access.createTypeConsumer('positive', 'export {};\n');
  const runtimeFixture = access.createRuntimeConsumer('runtime', 'export {};\n');
  runner.typeScript(access, typeFixture);
  runner.executeConsumer(access, runtimeFixture);
  runner.assertComplete(access);
  for (const capability of [
    () => runner.pack(),
    () => runner.publint(artifact),
    () => runner.attw(artifact),
    () => runner.extract(artifact),
    () => runner.prepareArtifact(artifact),
    () => runner.typeScript(access, typeFixture),
    () => runner.executeConsumer(access, runtimeFixture),
    () => runner.assertComplete(access),
  ]) {
    expect(capability).toThrow('[package-runner-complete]');
  }
  runner.dispose();
  expect(harness.removals).toHaveLength(1);
});

test('disposal closes every capability and caches cleanup failure identity', () => {
  const cleanupFailure = new Error('delete failed');
  let removals = 0;
  const registration = createPackageArtifactTreeForTest(process.cwd(), () => {
    removals += 1;
    throw cleanupFailure;
  });
  const { tree } = registration;
  const runner = createPackageCommandRunnerForTest(
    (capability) => (capability === 'pack' ? packOutput : ''),
    registration,
  );
  let first: unknown;
  try {
    runner.dispose();
  } catch (error: unknown) {
    first = error;
  }
  expect(first).toMatchObject({ message: '[package-cleanup]', cause: cleanupFailure });
  expect(() => runner.dispose()).toThrow(first);
  expect(removals).toBe(1);
  expect(() => runner.pack()).toThrow('[package-runner-disposed]');
  rmSync(join(tree.root, '..'), { recursive: true, force: true });
});

test('disposal is legal before pack and after failed pack, extraction, and preparation', () => {
  const beforePack = createHarness();
  createPackageCommandRunnerForTest(beforePack.executor, beforePack.registration).dispose();
  expect(beforePack.removals).toHaveLength(1);

  const failedPack = createHarness();
  const failedRunner = createPackageCommandRunnerForTest(() => {
    throw new Error('pack failed');
  }, failedPack.registration);
  expect(() => failedRunner.pack()).toThrow('pack failed');
  failedRunner.dispose();
  expect(failedPack.removals).toHaveLength(1);

  for (const prepare of [false, true]) {
    const harness = createHarness();
    const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration);
    const artifact = runner.pack();
    runner.extract(artifact);
    if (prepare) {
      runner.prepareArtifact(artifact);
    }
    runner.dispose();
    expect(harness.removals).toHaveLength(1);
  }
});

test('every capability fails after disposal began', () => {
  const harness = createHarness();
  const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration);
  const artifact = runner.pack();
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  const typeFixture = access.createTypeConsumer('positive', 'export {};\n');
  const runtimeFixture = access.createRuntimeConsumer('runtime', 'export {};\n');
  runner.dispose();
  for (const capability of [
    () => runner.pack(),
    () => runner.publint(artifact),
    () => runner.attw(artifact),
    () => runner.extract(artifact),
    () => runner.prepareArtifact(artifact),
    () => runner.typeScript(access, typeFixture),
    () => runner.executeConsumer(access, runtimeFixture),
    () => runner.assertComplete(access),
  ]) {
    expect(capability).toThrow('[package-runner-disposed]');
  }
});

test.each(['typeScript', 'consumer'] as const)(
  'disposal remains available after a %s failure',
  (failingCapability) => {
    const harness = createHarness();
    const runner = createPackageCommandRunnerForTest((capability, command) => {
      const result = harness.executor(capability, command);
      if (capability === failingCapability) {
        throw new Error(`${capability} failed`);
      }
      return result;
    }, harness.registration);
    const artifact = runner.pack();
    runner.extract(artifact);
    const access = runner.prepareArtifact(artifact);
    const failingCall =
      failingCapability === 'typeScript'
        ? () => runner.typeScript(access, access.createTypeConsumer('positive', 'export {};\n'))
        : () =>
            runner.executeConsumer(access, access.createRuntimeConsumer('runtime', 'export {};\n'));
    expect(failingCall).toThrow(`${failingCapability} failed`);
    runner.dispose();
    expect(harness.removals).toHaveLength(1);
  },
);
