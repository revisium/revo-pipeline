import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  validateModuleStructure,
  type SourceModule,
} from './architecture/validate-module-structure.js';
import {
  createPackageCommandRunner,
  type PackageArtifact,
  type PackageArtifactAccess,
} from './package/package-command-runner.js';
import { PACKAGE_CONSUMER_CASES } from './package/package-consumer-catalog.js';
import {
  ALIAS_TYPE_CONSUMER_SOURCE,
  DEFAULT_TYPE_CONSUMER_SOURCE,
  HOST_SHAPED_CONSUMER_SOURCE,
  PRIVATE_RUNTIME_CONSUMER_SOURCE,
  PRIVATE_TYPE_CONSUMER_SOURCE,
  RUNTIME_CONSUMER_SOURCE,
  SUBPATH_TYPE_CONSUMER_SOURCE,
  TYPE_CONSUMER_SOURCE,
  permissionFixtureSource,
} from './package/package-consumer-fixtures.js';
import { extractDocumentationExamples } from './package/package-documentation-examples.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const collectSourceModules = async (
  root: string,
  directory: string,
): Promise<readonly SourceModule[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry): Promise<readonly SourceModule[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectSourceModules(root, path);
      }
      if (!entry.name.endsWith('.ts')) {
        return [];
      }
      return [
        { path: relative(root, path).replaceAll('\\', '/'), source: await readFile(path, 'utf8') },
      ];
    }),
  );
  return groups.flat();
};

const expectedPackagePaths = (sourceModules: readonly SourceModule[]): readonly string[] => {
  validateModuleStructure(sourceModules);
  const compilerEmissions = sourceModules.flatMap(({ path }) => {
    assert.match(path, /^src\/.*\.ts$/);
    const output = `dist/${path.slice('src/'.length, -'.ts'.length)}`;
    return [`${output}.d.ts`, `${output}.d.ts.map`, `${output}.js`, `${output}.js.map`];
  });
  return ['LICENSE', 'README.md', 'package.json', ...compilerEmissions].sort();
};

const namedExports = (source: string): readonly string[] =>
  [...source.matchAll(/export(?: type)? \{([\s\S]*?)\} from/g)]
    .flatMap((match) => match[1]?.split(',') ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .sort();

const assertPackageMetadata = (manifest: Record<string, unknown>): void => {
  assert.deepEqual(
    {
      name: manifest['name'],
      version: manifest['version'],
      description: manifest['description'],
      homepage: manifest['homepage'],
      bugs: manifest['bugs'],
      license: manifest['license'],
      repository: manifest['repository'],
      files: manifest['files'],
      type: manifest['type'],
      sideEffects: manifest['sideEffects'],
      main: manifest['main'],
      types: manifest['types'],
      exports: manifest['exports'],
      engines: manifest['engines'],
      packageManager: manifest['packageManager'],
      publishConfig: manifest['publishConfig'],
      dependencies: manifest['dependencies'],
    },
    {
      name: '@revisium/revo-pipeline',
      version: '0.0.0',
      description: 'Portable pipeline definition, compilation, and transition semantics for Revo.',
      homepage: 'https://github.com/revisium/revo-pipeline#readme',
      bugs: { url: 'https://github.com/revisium/revo-pipeline/issues' },
      license: 'MIT',
      repository: { type: 'git', url: 'git+https://github.com/revisium/revo-pipeline.git' },
      files: ['dist', 'README.md', 'LICENSE'],
      type: 'module',
      sideEffects: false,
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      engines: { node: '>=24.11.1 <25' },
      packageManager: 'pnpm@11.13.0',
      publishConfig: { access: 'public', provenance: true },
      dependencies: undefined,
    },
  );
};

interface DisposablePackageRunner {
  dispose(): void;
}

export interface PackageVerificationPhaseSeams {
  readonly sourcePreparation: () => void | Promise<void>;
  readonly pack: () => void | Promise<void>;
  readonly extract: () => void | Promise<void>;
  readonly prepareAccess: () => void | Promise<void>;
  readonly metadataAndDeclarations: () => void | Promise<void>;
  readonly typeCompilation: () => void | Promise<void>;
  readonly runtimeConsumer: () => void | Promise<void>;
  readonly assertComplete: () => void | Promise<void>;
}

export const runPackageVerificationForTest = async <Result>(
  runner: DisposablePackageRunner,
  verify: () => Result | Promise<Result>,
): Promise<Result> => {
  let primaryError: unknown;
  let cleanupError: unknown;
  let outcome: { readonly value: Result } | undefined;
  try {
    outcome = { value: await verify() };
  } catch (error: unknown) {
    primaryError = error;
  } finally {
    try {
      runner.dispose();
    } catch (error: unknown) {
      cleanupError = error;
    }
  }
  if (primaryError !== undefined && cleanupError !== undefined) {
    throw new AggregateError([primaryError, cleanupError], '[package-verification-and-cleanup]', {
      cause: primaryError,
    });
  }
  if (primaryError !== undefined) {
    throw primaryError;
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
  if (!outcome) {
    throw new Error('[package-verification-result]');
  }
  return outcome.value;
};

export const runPackageVerificationPhasesForTest = async (
  runner: DisposablePackageRunner,
  phases: PackageVerificationPhaseSeams,
): Promise<void> =>
  runPackageVerificationForTest(runner, async () => {
    await phases.sourcePreparation();
    await phases.pack();
    await phases.extract();
    await phases.prepareAccess();
    await phases.metadataAndDeclarations();
    await phases.typeCompilation();
    await phases.runtimeConsumer();
    await phases.assertComplete();
  });

if (process.argv[1]?.endsWith('scripts/verify-package.ts')) {
  const root = process.cwd();
  const runner = createPackageCommandRunner();

  let expectedPaths: readonly string[] = [];
  let sourceRootDeclaration = '';
  let documentationSources = new Map<string, string>();
  let artifact: PackageArtifact | undefined;
  let access: PackageArtifactAccess | undefined;

  await runPackageVerificationPhasesForTest(runner, {
    sourcePreparation: async () => {
      const sourceModules = await collectSourceModules(root, join(root, 'src'));
      expectedPaths = expectedPackagePaths(sourceModules);
      sourceRootDeclaration = await readFile(join(root, 'src/index.ts'), 'utf8');
      const documentation = await Promise.all(
        PACKAGE_CONSUMER_CASES.flatMap((entry) =>
          entry.documentation
            ? [
                readFile(join(root, entry.documentation.documentPath), 'utf8').then((content) => ({
                  path: entry.documentation?.documentPath ?? '',
                  content,
                })),
              ]
            : [],
        ),
      );
      documentationSources = new Map(
        extractDocumentationExamples(documentation).map(({ caseId, source }) => [caseId, source]),
      );
      const sourceManifest: unknown = JSON.parse(
        await readFile(join(root, 'package.json'), 'utf8'),
      );
      assert.ok(isRecord(sourceManifest));
      assertPackageMetadata(sourceManifest);
    },
    pack: () => {
      artifact = runner.pack();
      const packedArtifact = artifact;
      assert.deepEqual(
        packedArtifact.manifest.files.map(({ path }) => path).sort(),
        expectedPaths,
        'The exact tarball contents must equal source-derived compiler emissions and fixed metadata.',
      );
    },
    extract: () => {
      const packedArtifact = artifact;
      if (!packedArtifact) {
        throw new Error('[package-artifact-unavailable]');
      }
      runner.publint(packedArtifact);
      runner.attw(packedArtifact);
      runner.extract(packedArtifact);
    },
    prepareAccess: () => {
      const packedArtifact = artifact;
      if (!packedArtifact) {
        throw new Error('[package-artifact-unavailable]');
      }
      access = runner.prepareArtifact(packedArtifact);
    },
    metadataAndDeclarations: () => {
      const preparedAccess = access;
      if (!preparedAccess) {
        throw new Error('[package-artifact-unavailable]');
      }
      assert.deepEqual(
        preparedAccess.readPackedFileManifest(),
        expectedPaths,
        'The reader must preserve the exact pack-manifest identity.',
      );
      assertPackageMetadata({ ...preparedAccess.readPackedManifest() });
      const rootDeclaration = preparedAccess.readRootDeclaration();
      assert.deepEqual(
        namedExports(sourceRootDeclaration),
        namedExports(rootDeclaration),
        'Packed declarations must expose exactly the source root names without aliases or defaults.',
      );
      assert.equal(
        namedExports(rootDeclaration).length,
        91,
        'Packed declarations must expose exactly five values and 86 types.',
      );
      const declarations = preparedAccess.readDeclarationManifest();
      const occurrenceDeclaration = declarations.find(
        ({ label }) => label === 'dist/spec/pipeline-occurrence-key.d.ts',
      );
      assert.ok(occurrenceDeclaration);
      assert.equal(
        occurrenceDeclaration.content,
        'export type PipelineOccurrenceKey = string;\n//# sourceMappingURL=pipeline-occurrence-key.d.ts.map',
        'The packed occurrence-key declaration must retain the exact accepted string alias.',
      );
      assert.ok(preparedAccess.readRootRuntimeModule().content.length > 0);
      assert.deepEqual(preparedAccess.readTypeClosureManifest(), [
        'undici-types@7.18.2',
        '@types/node@24.13.3',
      ]);
      preparedAccess.assertPackageRootResolution();
      preparedAccess.assertDeniedPackageResolution('@revisium/revo-pipeline/dist/index.js');
      preparedAccess.assertDeniedPackageResolution('@revisium/revo-pipeline/transition');
    },
    typeCompilation: () => {
      const preparedAccess = access;
      if (!preparedAccess) {
        throw new Error('[package-artifact-unavailable]');
      }
      const positive = preparedAccess.createTypeConsumer('positive', TYPE_CONSUMER_SOURCE);
      const hostShaped = preparedAccess.createTypeConsumer(
        'host-shaped',
        HOST_SHAPED_CONSUMER_SOURCE,
      );
      const taskBranchTerminal = preparedAccess.createTypeConsumer(
        'task-branch-terminal',
        documentationSources.get('task-branch-terminal') ?? '',
      );
      const forkJoinConsensusTerminal = preparedAccess.createTypeConsumer(
        'fork-join-consensus-terminal',
        documentationSources.get('fork-join-consensus-terminal') ?? '',
      );
      const humanGateTerminalReplay = preparedAccess.createTypeConsumer(
        'human-gate-terminal-replay',
        documentationSources.get('human-gate-terminal-replay') ?? '',
      );
      const decisionGrowth = preparedAccess.createTypeConsumer(
        'decision-growth',
        TYPE_CONSUMER_SOURCE,
      );
      const reductionGrowth = preparedAccess.createTypeConsumer(
        'reduction-growth',
        TYPE_CONSUMER_SOURCE,
      );
      const privateType = preparedAccess.createTypeConsumer(
        'private',
        PRIVATE_TYPE_CONSUMER_SOURCE,
      );
      const defaultType = preparedAccess.createTypeConsumer(
        'default',
        DEFAULT_TYPE_CONSUMER_SOURCE,
      );
      const aliasType = preparedAccess.createTypeConsumer('alias', ALIAS_TYPE_CONSUMER_SOURCE);
      const subpathType = preparedAccess.createTypeConsumer(
        'subpath',
        SUBPATH_TYPE_CONSUMER_SOURCE,
      );

      runner.typeScript(preparedAccess, positive);
      runner.typeScript(preparedAccess, hostShaped);
      runner.typeScript(preparedAccess, taskBranchTerminal);
      runner.typeScript(preparedAccess, forkJoinConsensusTerminal);
      runner.typeScript(preparedAccess, humanGateTerminalReplay);
      runner.typeScript(preparedAccess, decisionGrowth);
      runner.typeScript(preparedAccess, reductionGrowth);
      runner.typeScript(preparedAccess, privateType);
      runner.typeScript(preparedAccess, defaultType);
      runner.typeScript(preparedAccess, aliasType);
      runner.typeScript(preparedAccess, subpathType);
    },
    runtimeConsumer: () => {
      const preparedAccess = access;
      if (!preparedAccess) {
        throw new Error('[package-artifact-unavailable]');
      }
      const runtime = preparedAccess.createRuntimeConsumer('runtime', RUNTIME_CONSUMER_SOURCE);
      const privateRuntime = preparedAccess.createRuntimeConsumer(
        'private-runtime',
        PRIVATE_RUNTIME_CONSUMER_SOURCE,
      );
      const typedRuntime = preparedAccess.createRuntimeConsumer('positive', '');
      const hostRuntime = preparedAccess.createRuntimeConsumer('host-shaped', '');
      const taskBranchTerminalRuntime = preparedAccess.createRuntimeConsumer(
        'task-branch-terminal',
        '',
      );
      const forkJoinConsensusTerminalRuntime = preparedAccess.createRuntimeConsumer(
        'fork-join-consensus-terminal',
        '',
      );
      const humanGateTerminalReplayRuntime = preparedAccess.createRuntimeConsumer(
        'human-gate-terminal-replay',
        '',
      );
      const permissionRead = preparedAccess.createRuntimeConsumer(
        'permission-read',
        permissionFixtureSource('permission-read'),
      );
      const permissionWrite = preparedAccess.createRuntimeConsumer(
        'permission-write',
        permissionFixtureSource('permission-write'),
      );
      const permissionChild = preparedAccess.createRuntimeConsumer(
        'permission-child',
        permissionFixtureSource('permission-child'),
      );
      const permissionWorker = preparedAccess.createRuntimeConsumer(
        'permission-worker',
        permissionFixtureSource('permission-worker'),
      );

      runner.executeConsumer(preparedAccess, runtime);
      runner.executeConsumer(preparedAccess, privateRuntime);
      runner.executeConsumer(preparedAccess, typedRuntime);
      runner.executeConsumer(preparedAccess, hostRuntime);
      runner.executeConsumer(preparedAccess, taskBranchTerminalRuntime);
      runner.executeConsumer(preparedAccess, forkJoinConsensusTerminalRuntime);
      runner.executeConsumer(preparedAccess, humanGateTerminalReplayRuntime);
      runner.executeConsumer(preparedAccess, permissionRead);
      runner.executeConsumer(preparedAccess, permissionWrite);
      runner.executeConsumer(preparedAccess, permissionChild);
      runner.executeConsumer(preparedAccess, permissionWorker);
    },
    assertComplete: () => {
      const preparedAccess = access;
      const packedArtifact = artifact;
      if (!preparedAccess || !packedArtifact) {
        throw new Error('[package-artifact-unavailable]');
      }
      runner.assertComplete(preparedAccess);
      console.log(
        `Exact tarball validation passed (${packedArtifact.manifest.files.length} files; one pack, closed reader, real-file type closure, permission probes, metadata, declarations, runtime, strict consumers, executable examples, and denied imports).`,
      );
    },
  });
}
