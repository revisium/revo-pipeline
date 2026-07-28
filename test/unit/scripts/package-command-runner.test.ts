import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import {
  createPackageArtifactTreeForTest,
  prepareExhaustivenessDeclarationForTest,
  type PackageArtifactTree,
  type PackageArtifactTreeRegistration,
} from '../../../scripts/package/package-artifact-tree.js';
import {
  createPackageCommandRunnerForTest,
  type PackageArtifact,
  type PackageArtifactAccess,
  type PackageCommandExecutor,
  type PackageCommandRunner,
} from '../../../scripts/package/package-command-runner.js';
import {
  PACKAGE_CONSUMER_CASES,
  commitConsumerEvent,
} from '../../../scripts/package/package-consumer-catalog.js';

const packOutput = JSON.stringify([{ filename: 'revisium-revo-pipeline-0.0.0.tgz', files: [] }]);

const extractedFixture = (command: Parameters<PackageCommandExecutor>[1]): void => {
  const destination = command.arguments[command.arguments.indexOf('-C') + 1];
  if (!destination) {
    throw new Error('missing extraction destination');
  }
  mkdirSync(join(destination, 'dist/spec'), { recursive: true });
  mkdirSync(join(destination, 'dist/errors'), { recursive: true });
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
  writeFileSync(
    join(destination, 'dist/errors/pipeline-decision.d.ts'),
    'export type Decision = Alpha | RejectDecision;\n',
  );
  writeFileSync(
    join(destination, 'dist/errors/pipeline-reduction.d.ts'),
    'export type Reduction = ({}) | { fallback: true };\n',
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

const diagnosticFor = (command: Parameters<PackageCommandExecutor>[1]): string | undefined => {
  const text = command.arguments.join(' ');
  if (text.includes('decision-growth') || text.includes('reduction-growth')) {
    return 'TS2345';
  }
  if (text.includes('tsconfig.private.json') || text.includes('tsconfig.subpath.json')) {
    return 'TS2307';
  }
  if (text.includes('tsconfig.default.json')) {
    return 'TS1192';
  }
  if (text.includes('tsconfig.alias.json')) {
    return 'TS2305';
  }
  if (text.includes('private-runtime')) {
    return 'ERR_PACKAGE_PATH_NOT_EXPORTED';
  }
  return undefined;
};

const createHarness = (): Harness => {
  const commands: Parameters<PackageCommandExecutor>[0][] = [];
  const details: Parameters<PackageCommandExecutor>[1][] = [];
  const removals: string[] = [];
  const registration = createPackageArtifactTreeForTest(process.cwd(), (path) => {
    removals.push(path);
    rmSync(path, { recursive: true, force: true });
  });
  return {
    registration,
    tree: registration.tree,
    commands,
    details,
    removals,
    executor(capability, command) {
      commands.push(capability);
      details.push(command);
      if (capability === 'extract') {
        extractedFixture(command);
      }
      const diagnostic = diagnosticFor(command);
      if (diagnostic) {
        throw { stderr: diagnostic };
      }
      return capability === 'pack' ? packOutput : '';
    },
  };
};

const completeRunner = (
  runner: PackageCommandRunner,
): { readonly artifact: PackageArtifact; readonly access: PackageArtifactAccess } => {
  const artifact = runner.pack();
  runner.publint(artifact);
  runner.attw(artifact);
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  for (const entry of PACKAGE_CONSUMER_CASES) {
    if (entry.type) {
      runner.typeScript(access, access.createTypeConsumer(entry.id, 'export {};\n'));
    }
  }
  for (const entry of PACKAGE_CONSUMER_CASES) {
    if (entry.runtime) {
      runner.executeConsumer(access, access.createRuntimeConsumer(entry.id, 'export {};\n'));
    }
  }
  runner.assertComplete(access);
  return { artifact, access };
};

test('executes every catalog case exactly once before complete and dispose', () => {
  const harness = createHarness();
  const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration);
  completeRunner(runner);
  expect(harness.commands.filter((command) => command === 'typeScript')).toHaveLength(11);
  expect(harness.commands.filter((command) => command === 'consumer')).toHaveLength(11);
  runner.dispose();
  expect(harness.removals).toHaveLength(1);
});

test('poisons completion after a caught lifecycle failure', () => {
  const harness = createHarness();
  const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration);
  const artifact = runner.pack();
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  const positive = access.createTypeConsumer('positive', 'export {};\n');
  expect(() => runner.typeScript(access, positive)).not.toThrow();
  expect(() => access.createTypeConsumer('positive', 'export {};\n')).toThrow(
    '[package-consumer-denied]',
  );
  expect(() => runner.assertComplete(access)).toThrow('[package-consumer-denied]');
  runner.dispose();
});

test('restores declaration bytes before committing a union-growth diagnostic', () => {
  const harness = createHarness();
  const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration);
  const artifact = runner.pack();
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  const fixture = access.createTypeConsumer('decision-growth', 'export {};\n');
  runner.typeScript(access, fixture);
  expect(
    readFileSync(
      join(harness.tree.installedPackageRoot, 'dist/errors/pipeline-decision.d.ts'),
      'utf8',
    ),
  ).toBe('export type Decision = Alpha | RejectDecision;\n');
  expect(() => runner.typeScript(access, fixture)).toThrow('[package-consumer-denied]');
  runner.dispose();
});

test('keeps cleanup available after consumer identity failure', () => {
  const harness = createHarness();
  const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration);
  const artifact = runner.pack();
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  const fixture = access.createRuntimeConsumer('runtime', 'export {};\n');
  expect(() => runner.executeConsumer({ ...access }, fixture)).toThrow(
    '[package-artifact-identity]',
  );
  runner.dispose();
  expect(harness.removals).toHaveLength(1);
});

test('rejects second and failed-then-retried pack', () => {
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
  const runtimeFixture = access.createRuntimeConsumer('runtime', 'export {};\n');
  expect(() => runner.prepareArtifact(artifact)).toThrow('[package-artifact-identity]');
  expect(() => runner.executeConsumer({ ...access }, runtimeFixture)).toThrow(
    '[package-artifact-identity]',
  );

  const second = createHarness();
  const foreign = createPackageCommandRunnerForTest(second.executor, second.registration);
  expect(() => foreign.executeConsumer(access, runtimeFixture)).toThrow(
    '[package-artifact-identity]',
  );
  runner.dispose();
  foreign.dispose();
});

test('closes every capability after completion while preserving disposal', () => {
  const harness = createHarness();
  const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration);
  const { artifact, access } = completeRunner(runner);
  for (const capability of [
    () => runner.pack(),
    () => runner.publint(artifact),
    () => runner.attw(artifact),
    () => runner.extract(artifact),
    () => runner.prepareArtifact(artifact),
    () => runner.typeScript(access, {}),
    () => runner.executeConsumer(access, {}),
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
  rmSync(join(registration.tree.root, '..'), { recursive: true, force: true });
});

test('disposal is legal before pack and after failed pack, extraction, and preparation', () => {
  const beforePack = createHarness();
  createPackageCommandRunnerForTest(beforePack.executor, beforePack.registration).dispose();
  const failedPack = createHarness();
  const failedRunner = createPackageCommandRunnerForTest(() => {
    throw new Error('pack failed');
  }, failedPack.registration);
  expect(() => failedRunner.pack()).toThrow('pack failed');
  failedRunner.dispose();
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

test.each(['typeScript', 'consumer'] as const)(
  'disposal remains available after a %s command failure',
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
    const call =
      failingCapability === 'typeScript'
        ? () => runner.typeScript(access, access.createTypeConsumer('positive', 'export {};\n'))
        : () =>
            runner.executeConsumer(access, access.createRuntimeConsumer('runtime', 'export {};\n'));
    expect(call).toThrow(`${failingCapability} failed`);
    runner.dispose();
    expect(harness.removals).toHaveLength(1);
  },
);

test('poisons null, throwing, and foreign fixture ownership before property access escapes', () => {
  const harness = createHarness();
  const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration);
  const artifact = runner.pack();
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  for (const fixture of [
    null,
    Object.defineProperty({}, 'caseId', {
      get: () => {
        throw new Error('untrusted getter escaped');
      },
    }),
    { caseId: 'positive' },
  ]) {
    expect(() => runner.typeScript(access, fixture)).toThrow('[package-artifact-identity]');
  }
  expect(() => runner.assertComplete(access)).toThrow('[package-consumer-operation-failed]');
  runner.dispose();
});

test('never accepts a preparation failure as the expected compiler diagnostic', () => {
  const harness = createHarness();
  const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration, {
    prepareDeclaration: () => {
      throw new Error('preparation TS2345');
    },
  });
  const artifact = runner.pack();
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  const fixture = access.createTypeConsumer('decision-growth', 'export {};\n');
  expect(() => runner.typeScript(access, fixture)).toThrow('preparation TS2345');
  expect(harness.commands.filter((command) => command === 'typeScript')).toHaveLength(0);
  expect(() => runner.assertComplete(access)).toThrow('[package-consumer-operation-failed]');
  runner.dispose();
});

test('poisons initial-read and absent-sentinel preparation partitions without writes', () => {
  const initialReadFailure = new Error('initial declaration read failed');
  for (const scenario of [
    {
      caseId: 'decision-growth' as const,
      read: () => {
        throw initialReadFailure;
      },
      expected: initialReadFailure,
    },
    {
      caseId: 'decision-growth' as const,
      read: () => Buffer.from('export type Decision = Alpha;'),
      expected: '[package-artifact-boundary]',
    },
    {
      caseId: 'reduction-growth' as const,
      read: () => Buffer.from('export type Reduction = { status: string };'),
      expected: '[package-artifact-boundary]',
    },
  ]) {
    const harness = createHarness();
    let writes = 0;
    const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration, {
      prepareDeclaration: (tree, kind) =>
        prepareExhaustivenessDeclarationForTest(tree, kind, {
          read: scenario.read,
          write: () => {
            writes += 1;
          },
        }),
    });
    const artifact = runner.pack();
    runner.extract(artifact);
    const access = runner.prepareArtifact(artifact);
    const fixture = access.createTypeConsumer(scenario.caseId, 'export {};\n');
    let failure: unknown;
    try {
      runner.typeScript(access, fixture);
    } catch (error: unknown) {
      failure = error;
    }
    const expectedMessage =
      scenario.expected instanceof Error ? scenario.expected.message : scenario.expected;
    expect(failure).toBeInstanceOf(Error);
    expect(failure instanceof Error ? failure.message : undefined).toBe(expectedMessage);
    expect(failure === scenario.expected).toBe(scenario.expected instanceof Error);
    expect(writes).toBe(0);
    expect(harness.commands.filter((command) => command === 'typeScript')).toHaveLength(0);
    expect(() => runner.assertComplete(access)).toThrow('[package-consumer-operation-failed]');
    runner.dispose();
    expect(harness.removals).toHaveLength(1);
  }
});

test('orders compiler as primary and restoration as secondary failure', () => {
  const harness = createHarness();
  const compilerFailure = { stderr: 'TS9999' };
  const restoreFailure = new Error('restore failed');
  const runner = createPackageCommandRunnerForTest(
    (capability, command) => {
      if (capability === 'typeScript') {
        harness.commands.push(capability);
        throw compilerFailure;
      }
      return harness.executor(capability, command);
    },
    harness.registration,
    {
      restoreDeclaration: () => {
        throw restoreFailure;
      },
    },
  );
  const artifact = runner.pack();
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  const fixture = access.createTypeConsumer('decision-growth', 'export {};\n');
  let failure: unknown;
  try {
    runner.typeScript(access, fixture);
  } catch (error: unknown) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError)) {
    throw new Error('expected aggregate failure');
  }
  expect(failure.message).toBe('[package-typescript-and-restore]');
  expect(failure.errors).toEqual([compilerFailure, restoreFailure]);
  expect(() => runner.assertComplete(access)).toThrow('[package-consumer-operation-failed]');
  runner.dispose();
});

test('poisons completion when an authorized commit is denied', () => {
  const harness = createHarness();
  const runner = createPackageCommandRunnerForTest(harness.executor, harness.registration, {
    commitEvent: (state, authorization) => commitConsumerEvent(state, { ...authorization }),
  });
  const artifact = runner.pack();
  runner.extract(artifact);
  const access = runner.prepareArtifact(artifact);
  expect(() => access.createTypeConsumer('positive', 'export {};\n')).toThrow(
    '[package-consumer-commit-denied]',
  );
  expect(() => runner.assertComplete(access)).toThrow('[package-consumer-commit-denied]');
  runner.dispose();
});
