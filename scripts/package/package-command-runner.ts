import { execFileSync } from 'node:child_process';

import {
  assertPackageResolution,
  auditPackageArtifactTree,
  cleanupPackageArtifactTree,
  createPackageArtifactTree,
  ensureExtractionRoot,
  expectedPackageEntryUrl,
  inspectTypeClosure,
  materializeTypeClosure,
  packageArchivePath,
  packageArchiveDirectory,
  packageCachePath,
  packageCompilerPath,
  permissionFixturePaths,
  readTreeFile,
  runtimeFixturePath,
  prepareExhaustivenessDeclaration,
  restoreExhaustivenessDeclaration,
  writeOutsideSentinel,
  writeTreeFile,
  type PackageArtifactTree,
  type PackageArtifactTreeRegistration,
  type PreparedDeclarationMutation,
} from './package-artifact-tree.js';
import {
  assertConsumerComplete,
  authorizeConsumerEvent,
  commitConsumerEvent,
  consumerExpectedDiagnostic,
  consumerRuntimeCase,
  consumerTypeCase,
  initialConsumerCompletionState,
  poisonConsumerCompletion,
  type ConsumerAuthorization,
  type ConsumerCaseId,
  type ConsumerCompletionState,
} from './package-consumer-catalog.js';
import { planTypeClosure } from './package-type-closure.js';

const artifactBrand: unique symbol = Symbol('PackageArtifact');
const accessBrand: unique symbol = Symbol('PackageArtifactAccess');
const typeFixtureBrand: unique symbol = Symbol('OwnedTypeConsumer');
const runtimeFixtureBrand: unique symbol = Symbol('OwnedRuntimeConsumer');

interface PackFile {
  readonly path: string;
}

export interface PackagePackManifest {
  readonly filename: string;
  readonly files: readonly PackFile[];
}

export interface PackageArtifact {
  readonly [artifactBrand]: true;
  readonly manifest: PackagePackManifest;
}

export interface OwnedTypeConsumer {
  readonly [typeFixtureBrand]: true;
  readonly caseId: ConsumerCaseId;
}

export interface OwnedRuntimeConsumer {
  readonly [runtimeFixtureBrand]: true;
  readonly caseId: ConsumerCaseId;
}

export interface PackedFileRecord {
  readonly label: string;
  readonly content: string;
}

export interface PackageArtifactAccess {
  readonly [accessBrand]: true;
  readPackedManifest(): Readonly<Record<string, unknown>>;
  readRootDeclaration(): string;
  readRootRuntimeModule(): PackedFileRecord;
  readPackedFileManifest(): readonly string[];
  readDeclarationManifest(): readonly PackedFileRecord[];
  readTypeClosureManifest(): readonly string[];
  createTypeConsumer(caseId: ConsumerCaseId, source: string): OwnedTypeConsumer;
  createRuntimeConsumer(caseId: ConsumerCaseId, source: string): OwnedRuntimeConsumer;
  assertPackageRootResolution(): void;
  assertDeniedPackageResolution(
    specifier: '@revisium/revo-pipeline/dist/index.js' | '@revisium/revo-pipeline/transition',
  ): void;
}

export interface PackageCommandRunner {
  pack(): PackageArtifact;
  publint(artifact: PackageArtifact): void;
  attw(artifact: PackageArtifact): void;
  extract(artifact: PackageArtifact): void;
  prepareArtifact(artifact: PackageArtifact): PackageArtifactAccess;
  typeScript(access: PackageArtifactAccess, fixture: unknown): void;
  executeConsumer(access: PackageArtifactAccess, fixture: unknown): void;
  assertComplete(access: PackageArtifactAccess): void;
  dispose(): void;
}

type CommandCapability = 'pack' | 'publint' | 'attw' | 'extract' | 'typeScript' | 'consumer';

interface Command {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly encoding?: BufferEncoding;
  readonly environment?: NodeJS.ProcessEnv;
  readonly output: 'capture' | 'inherit';
  readonly stdio?: ['ignore', 'pipe', 'pipe'];
}

export type PackageCommandExecutor = (command: CommandCapability, details: Command) => unknown;

export interface PackageRunnerTestSeams {
  readonly prepareDeclaration?: typeof prepareExhaustivenessDeclaration;
  readonly restoreDeclaration?: typeof restoreExhaustivenessDeclaration;
  readonly commitEvent?: typeof commitConsumerEvent;
}

const productionExecutor: PackageCommandExecutor = (_capability, command) =>
  execFileSync(command.executable, command.arguments, {
    cwd: command.cwd,
    encoding: command.encoding,
    env: command.environment,
    stdio: command.stdio ?? (command.output === 'inherit' ? 'inherit' : 'pipe'),
    shell: false,
  });

interface ArtifactDetails {
  readonly archivePath: string;
  extracted: boolean;
}

interface RuntimeLaunch {
  readonly cwd: string;
  readonly entrypoint: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPackManifest = (value: unknown): value is PackagePackManifest =>
  isRecord(value) &&
  typeof value['filename'] === 'string' &&
  Array.isArray(value['files']) &&
  value['files'].every((file: unknown) => isRecord(file) && typeof file['path'] === 'string');

const outputText = (value: unknown): string =>
  typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : '';

const failureOutput = (error: unknown): string =>
  isRecord(error) ? `${outputText(error['stdout'])}${outputText(error['stderr'])}` : String(error);

class PackageArtifactAccessOwner {
  readonly access: PackageArtifactAccess;
  readonly #tree: PackageArtifactTree;
  readonly #artifact: PackageArtifact;
  readonly #typeFixtures = new WeakSet<object>();
  readonly #runtimeFixtures = new WeakSet<object>();
  readonly #typeCaseIds = new WeakMap<object, ConsumerCaseId>();
  readonly #runtimeCaseIds = new WeakMap<object, ConsumerCaseId>();
  readonly #typePaths = new WeakMap<object, string>();
  readonly #runtimePaths = new WeakMap<object, string>();
  readonly #closureManifest: readonly string[];

  constructor(
    tree: PackageArtifactTree,
    artifact: PackageArtifact,
    createType: (caseId: ConsumerCaseId, source: string) => OwnedTypeConsumer,
    createRuntime: (caseId: ConsumerCaseId, source: string) => OwnedRuntimeConsumer,
    readonly prepareDeclaration: typeof prepareExhaustivenessDeclaration,
    readonly restoreDeclaration: typeof restoreExhaustivenessDeclaration,
  ) {
    this.#tree = tree;
    this.#artifact = artifact;
    const inspection = inspectTypeClosure(tree);
    const plan = planTypeClosure(inspection);
    materializeTypeClosure(tree, inspection, plan);
    this.#closureManifest = Object.freeze(plan.map(({ name, version }) => `${name}@${version}`));
    writeTreeFile(tree, 'package.json', `${JSON.stringify({ private: true, type: 'module' })}\n`);
    const access: PackageArtifactAccess = {
      [accessBrand]: true,
      readPackedManifest: () => this.readPackedManifest(),
      readRootDeclaration: () => this.readRootDeclaration(),
      readRootRuntimeModule: () => this.readRootRuntimeModule(),
      readPackedFileManifest: () => this.readPackedFileManifest(),
      readDeclarationManifest: () => this.readDeclarationManifest(),
      readTypeClosureManifest: () => this.#closureManifest,
      createTypeConsumer: createType,
      createRuntimeConsumer: createRuntime,
      assertPackageRootResolution: () => assertPackageResolution(this.#tree),
      assertDeniedPackageResolution: (specifier) =>
        assertPackageResolution(this.#tree, specifier.slice('@revisium/revo-pipeline'.length)),
    };
    this.access = Object.freeze(access);
  }

  readPackedManifest(): Readonly<Record<string, unknown>> {
    const parsed: unknown = JSON.parse(
      readTreeFile(this.#tree, 'node_modules/@revisium/revo-pipeline/package.json'),
    );
    if (!isRecord(parsed)) {
      throw new Error('[package-artifact-boundary]');
    }
    return Object.freeze(parsed);
  }

  readRootDeclaration(): string {
    return readTreeFile(this.#tree, 'node_modules/@revisium/revo-pipeline/dist/index.d.ts');
  }

  readRootRuntimeModule(): PackedFileRecord {
    return Object.freeze({
      label: 'dist/index.js',
      content: readTreeFile(this.#tree, 'node_modules/@revisium/revo-pipeline/dist/index.js'),
    });
  }

  readPackedFileManifest(): readonly string[] {
    return Object.freeze(this.#artifact.manifest.files.map(({ path }) => path).sort());
  }

  readDeclarationManifest(): readonly PackedFileRecord[] {
    return Object.freeze([
      Object.freeze({ label: 'dist/index.d.ts', content: this.readRootDeclaration() }),
      Object.freeze({
        label: 'dist/spec/pipeline-occurrence-key.d.ts',
        content: readTreeFile(
          this.#tree,
          'node_modules/@revisium/revo-pipeline/dist/spec/pipeline-occurrence-key.d.ts',
        ),
      }),
    ]);
  }

  writeTypeConsumer(caseId: ConsumerCaseId, source: string): OwnedTypeConsumer {
    const type = consumerTypeCase(caseId);
    if (!type) {
      throw new Error('[package-consumer-case]');
    }
    writeTreeFile(this.#tree, type.sourcePath, source);
    const configuration = writeTreeFile(
      this.#tree,
      type.configurationPath,
      `${JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2024',
            lib: ['ES2024'],
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            moduleDetection: 'force',
            rootDir: '.',
            strict: true,
            noUncheckedIndexedAccess: true,
            exactOptionalPropertyTypes: true,
            outDir: 'out',
            skipLibCheck: false,
            types: ['node'],
          },
          include: [type.sourcePath],
        },
        undefined,
        2,
      )}\n`,
    );
    const fixture: OwnedTypeConsumer = Object.freeze({
      [typeFixtureBrand]: true as const,
      caseId,
    });
    this.#typeFixtures.add(fixture);
    this.#typeCaseIds.set(fixture, caseId);
    this.#typePaths.set(fixture, configuration);
    return fixture;
  }

  writeRuntimeConsumer(caseId: ConsumerCaseId, source: string): OwnedRuntimeConsumer {
    const runtime = consumerRuntimeCase(caseId);
    if (!runtime) {
      throw new Error('[package-consumer-case]');
    }
    const relativePath = runtime.entryPath;
    let entrypoint = runtimeFixturePath(this.#tree, relativePath);
    if (caseId.startsWith('permission-')) {
      const permissionPaths = permissionFixturePaths(this.#tree);
      entrypoint = writeTreeFile(
        this.#tree,
        relativePath,
        source
          .replaceAll('__OUTSIDE_SENTINEL__', permissionPaths.outside)
          .replace('__INSIDE_WRITE__', permissionPaths.inside),
      );
      writeOutsideSentinel(this.#tree);
    } else if (source.length > 0) {
      entrypoint = writeTreeFile(
        this.#tree,
        relativePath,
        source.replace('__PACKAGE_ROOT_ENTRY__', expectedPackageEntryUrl(this.#tree)),
      );
    }
    const fixture: OwnedRuntimeConsumer = Object.freeze({
      [runtimeFixtureBrand]: true as const,
      caseId,
    });
    this.#runtimeFixtures.add(fixture);
    this.#runtimeCaseIds.set(fixture, caseId);
    this.#runtimePaths.set(fixture, entrypoint);
    return fixture;
  }

  configurationPath(fixture: unknown): string {
    if (!isRecord(fixture) || !this.#typeFixtures.has(fixture)) {
      throw new Error('[package-artifact-identity]');
    }
    const path = this.#typePaths.get(fixture);
    if (!path) {
      throw new Error('[package-artifact-identity]');
    }
    return path;
  }

  typeCaseId(fixture: unknown): ConsumerCaseId {
    if (!isRecord(fixture) || !this.#typeFixtures.has(fixture)) {
      throw new Error('[package-artifact-identity]');
    }
    const caseId = this.#typeCaseIds.get(fixture);
    if (!caseId) {
      throw new Error('[package-artifact-identity]');
    }
    return caseId;
  }

  runtimeCaseId(fixture: unknown): ConsumerCaseId {
    if (!isRecord(fixture) || !this.#runtimeFixtures.has(fixture)) {
      throw new Error('[package-artifact-identity]');
    }
    const caseId = this.#runtimeCaseIds.get(fixture);
    if (!caseId) {
      throw new Error('[package-artifact-identity]');
    }
    return caseId;
  }

  prepareTypeScript(fixture: unknown): PreparedDeclarationMutation | undefined {
    const type = consumerTypeCase(this.typeCaseId(fixture));
    if (!type?.mutation) {
      return undefined;
    }
    return this.prepareDeclaration(this.#tree, type.mutation);
  }

  restoreTypeScript(prepared: PreparedDeclarationMutation): void {
    this.restoreDeclaration(this.#tree, prepared);
  }

  runtimeLaunch(fixture: unknown): RuntimeLaunch {
    this.runtimeCaseId(fixture);
    if (!isRecord(fixture)) {
      throw new Error('[package-artifact-identity]');
    }
    const entrypoint = this.#runtimePaths.get(fixture);
    if (!entrypoint) {
      throw new Error('[package-artifact-identity]');
    }
    // Trusted same-process fixtures are audited immediately before launch.
    // This is not a race-free guarantee against concurrent filesystem mutation.
    auditPackageArtifactTree(this.#tree, entrypoint);
    return { cwd: this.#tree.root, entrypoint };
  }
}

const createRunner = (
  executor: PackageCommandExecutor,
  registration: PackageArtifactTreeRegistration,
  seams: PackageRunnerTestSeams = {},
): PackageCommandRunner => {
  const { owner, tree } = registration;
  let state: 'not-packed' | 'packed' | 'complete' | 'disposed' = 'not-packed';
  let packAttempts = 0;
  let artifact: PackageArtifact | undefined;
  let cleanupError: Error | undefined;
  const artifacts = new WeakMap<object, ArtifactDetails>();
  const readers = new WeakMap<object, PackageArtifactAccessOwner>();
  const accesses = new WeakMap<object, PackageArtifactAccessOwner>();
  let completionState: ConsumerCompletionState = initialConsumerCompletionState();
  const prepareDeclaration = seams.prepareDeclaration ?? prepareExhaustivenessDeclaration;
  const restoreDeclaration = seams.restoreDeclaration ?? restoreExhaustivenessDeclaration;
  const commitEvent = seams.commitEvent ?? commitConsumerEvent;

  const requireActive = (): void => {
    if (state === 'disposed') {
      throw new Error('[package-runner-disposed]');
    }
    if (state === 'complete') {
      throw new Error('[package-runner-complete]');
    }
  };
  const requireArtifact = (candidate: PackageArtifact): ArtifactDetails => {
    requireActive();
    if (!artifact) {
      throw new Error('[package-artifact-unavailable]');
    }
    const details = artifacts.get(candidate);
    if (candidate !== artifact || !details) {
      throw new Error('[package-artifact-identity]');
    }
    return details;
  };
  const requireAccess = (candidate: PackageArtifactAccess): PackageArtifactAccessOwner => {
    requireActive();
    const reader = accesses.get(candidate);
    if (!reader || readers.get(artifact ?? {}) !== reader) {
      throw new Error('[package-artifact-identity]');
    }
    return reader;
  };
  const run = (capability: CommandCapability, command: Command): unknown =>
    executor(capability, command);
  const failConsumer = (error: unknown): never => {
    completionState = poisonConsumerCompletion(
      completionState,
      '[package-consumer-operation-failed]',
    );
    throw error;
  };
  const authorization = (
    caseId: ConsumerCaseId,
    phase: 'createType' | 'createRuntime',
  ): ConsumerAuthorization => {
    const result = authorizeConsumerEvent(completionState, caseId, phase);
    completionState = result.state;
    if (!result.ok) {
      throw new Error(result.fault.message);
    }
    return result.value;
  };
  const commit = (event: ConsumerAuthorization): void => {
    const result = commitEvent(completionState, event);
    completionState = result.state;
    if (!result.ok) {
      throw new Error(result.fault.message);
    }
  };

  return Object.freeze({
    pack(): PackageArtifact {
      requireActive();
      packAttempts += 1;
      if (packAttempts !== 1) {
        throw new Error('[package-pack-multiplicity]');
      }
      const result = run('pack', {
        executable: 'npm',
        arguments: [
          'pack',
          '--json',
          '--ignore-scripts',
          '--pack-destination',
          packageArchiveDirectory(tree),
        ],
        cwd: tree.workspaceRoot,
        encoding: 'utf8',
        environment: {
          ...process.env,
          npm_config_cache: packageCachePath(tree),
          npm_config_loglevel: 'silent',
        },
        output: 'capture',
      });
      const parsed: unknown = JSON.parse(outputText(result));
      if (!Array.isArray(parsed) || parsed.length !== 1 || !isPackManifest(parsed[0])) {
        throw new Error('[package-pack-manifest]');
      }
      const manifest = Object.freeze({
        ...parsed[0],
        files: Object.freeze([...parsed[0].files]),
      });
      const created: PackageArtifact = Object.freeze({
        [artifactBrand]: true as const,
        manifest,
      });
      artifact = created;
      artifacts.set(created, {
        archivePath: packageArchivePath(tree, manifest.filename),
        extracted: false,
      });
      state = 'packed';
      return created;
    },
    publint(candidate: PackageArtifact): void {
      const details = requireArtifact(candidate);
      run('publint', {
        executable: 'publint',
        arguments: [details.archivePath, '--strict'],
        cwd: tree.workspaceRoot,
        output: 'inherit',
      });
    },
    attw(candidate: PackageArtifact): void {
      const details = requireArtifact(candidate);
      run('attw', {
        executable: 'attw',
        arguments: [details.archivePath, '--profile', 'esm-only'],
        cwd: tree.workspaceRoot,
        output: 'inherit',
      });
    },
    extract(candidate: PackageArtifact): void {
      const details = requireArtifact(candidate);
      ensureExtractionRoot(tree);
      run('extract', {
        executable: 'tar',
        arguments: [
          '-xzf',
          details.archivePath,
          '-C',
          tree.installedPackageRoot,
          '--strip-components=1',
        ],
        cwd: tree.root,
        output: 'capture',
      });
      details.extracted = true;
    },
    prepareArtifact(candidate: PackageArtifact): PackageArtifactAccess {
      const details = requireArtifact(candidate);
      if (!details.extracted || readers.has(candidate)) {
        throw new Error('[package-artifact-identity]');
      }
      let reader: PackageArtifactAccessOwner;
      const createType = (caseId: ConsumerCaseId, source: string): OwnedTypeConsumer => {
        const event = authorization(caseId, 'createType');
        try {
          const fixture = reader.writeTypeConsumer(caseId, source);
          commit(event);
          return fixture;
        } catch (error: unknown) {
          return failConsumer(error);
        }
      };
      const createRuntime = (caseId: ConsumerCaseId, source: string): OwnedRuntimeConsumer => {
        const event = authorization(caseId, 'createRuntime');
        try {
          const fixture = reader.writeRuntimeConsumer(caseId, source);
          commit(event);
          return fixture;
        } catch (error: unknown) {
          return failConsumer(error);
        }
      };
      reader = new PackageArtifactAccessOwner(
        tree,
        candidate,
        createType,
        createRuntime,
        prepareDeclaration,
        restoreDeclaration,
      );
      readers.set(candidate, reader);
      accesses.set(reader.access, reader);
      return reader.access;
    },
    typeScript(candidate: PackageArtifactAccess, fixture: unknown): void {
      let reader: PackageArtifactAccessOwner;
      let caseId: ConsumerCaseId;
      try {
        reader = requireAccess(candidate);
        caseId = reader.typeCaseId(fixture);
      } catch (error: unknown) {
        return failConsumer(error);
      }
      const authorizationResult = authorizeConsumerEvent(completionState, caseId, 'typeScript');
      completionState = authorizationResult.state;
      if (!authorizationResult.ok) {
        throw new Error(authorizationResult.fault.message);
      }
      let prepared: PreparedDeclarationMutation | undefined;
      let preparationError: unknown;
      let compilerError: unknown;
      let compilerExecuted = false;
      let restoreError: unknown;
      try {
        prepared = reader.prepareTypeScript(fixture);
      } catch (error: unknown) {
        preparationError = error;
      }
      if (preparationError === undefined) {
        try {
          compilerExecuted = true;
          run('typeScript', {
            executable: packageCompilerPath(tree),
            arguments: ['-p', reader.configurationPath(fixture)],
            cwd: tree.root,
            output: 'capture',
          });
        } catch (error: unknown) {
          compilerError = error;
        }
      }
      if (prepared) {
        try {
          reader.restoreTypeScript(prepared);
        } catch (error: unknown) {
          restoreError = error;
        }
      }
      const expectedDiagnostic = consumerExpectedDiagnostic(
        consumerTypeCase(caseId)?.expected ?? 'success',
      );
      if (expectedDiagnostic !== undefined) {
        if (
          !compilerExecuted ||
          compilerError === undefined ||
          !failureOutput(compilerError).includes(expectedDiagnostic)
        ) {
          compilerError =
            compilerError ??
            new Error(`[package-consumer-diagnostic] Expected ${expectedDiagnostic}`);
        } else {
          compilerError = undefined;
        }
      }
      const primaryError = preparationError ?? compilerError;
      if (primaryError !== undefined || restoreError !== undefined) {
        completionState = poisonConsumerCompletion(
          completionState,
          '[package-consumer-operation-failed]',
        );
        if (primaryError !== undefined && restoreError !== undefined) {
          throw new AggregateError(
            [primaryError, restoreError],
            '[package-typescript-and-restore]',
            {
              cause: primaryError,
            },
          );
        }
        if (primaryError !== undefined) {
          throw primaryError;
        }
        throw new Error('[package-typescript-restore]', { cause: restoreError });
      }
      const commitResult = commitEvent(completionState, authorizationResult.value);
      completionState = commitResult.state;
      if (!commitResult.ok) {
        throw new Error(commitResult.fault.message);
      }
    },
    executeConsumer(candidate: PackageArtifactAccess, fixture: unknown): void {
      let reader: PackageArtifactAccessOwner;
      let caseId: ConsumerCaseId;
      try {
        reader = requireAccess(candidate);
        caseId = reader.runtimeCaseId(fixture);
      } catch (error: unknown) {
        return failConsumer(error);
      }
      const authorizationResult = authorizeConsumerEvent(completionState, caseId, 'executeRuntime');
      completionState = authorizationResult.state;
      if (!authorizationResult.ok) {
        throw new Error(authorizationResult.fault.message);
      }
      let failure: unknown;
      try {
        const launch = reader.runtimeLaunch(fixture);
        run('consumer', {
          executable: process.execPath,
          arguments: ['--permission', `--allow-fs-read=${tree.root}`, launch.entrypoint],
          cwd: launch.cwd,
          environment: {},
          output: 'capture',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error: unknown) {
        failure = error;
      }
      const expectedDiagnostic = consumerExpectedDiagnostic(
        consumerRuntimeCase(caseId)?.expected ?? 'success',
      );
      if (expectedDiagnostic !== undefined) {
        if (failure === undefined || !failureOutput(failure).includes(expectedDiagnostic)) {
          failure =
            failure ?? new Error(`[package-consumer-diagnostic] Expected ${expectedDiagnostic}`);
        } else {
          failure = undefined;
        }
      }
      if (failure !== undefined) {
        return failConsumer(failure);
      }
      const commitResult = commitEvent(completionState, authorizationResult.value);
      completionState = commitResult.state;
      if (!commitResult.ok) {
        throw new Error(commitResult.fault.message);
      }
    },
    assertComplete(candidate: PackageArtifactAccess): void {
      requireAccess(candidate);
      if (packAttempts !== 1 || !artifact) {
        throw new Error('[package-runner-incomplete]');
      }
      const result = assertConsumerComplete(completionState);
      completionState = result.state;
      if (!result.ok) {
        throw new Error(result.fault.message);
      }
      state = 'complete';
    },
    dispose(): void {
      if (state === 'disposed') {
        if (cleanupError) {
          throw cleanupError;
        }
        return;
      }
      state = 'disposed';
      try {
        cleanupPackageArtifactTree(owner, tree);
      } catch (error: unknown) {
        cleanupError =
          error instanceof Error && error.message === '[package-cleanup]'
            ? error
            : new Error('[package-cleanup]', { cause: error });
        throw cleanupError;
      }
    },
  });
};

export const createPackageCommandRunner = (): PackageCommandRunner =>
  createRunner(productionExecutor, createPackageArtifactTree(process.cwd()));

export const createPackageCommandRunnerForTest = (
  executor: PackageCommandExecutor,
  registration: PackageArtifactTreeRegistration,
  seams: PackageRunnerTestSeams = {},
): PackageCommandRunner => createRunner(executor, registration, seams);
