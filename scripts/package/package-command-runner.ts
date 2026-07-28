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
  mutateExhaustivenessDeclaration,
  packageArchivePath,
  packageArchiveDirectory,
  packageCachePath,
  packageCompilerPath,
  permissionFixturePaths,
  readTreeFile,
  runtimeFixturePath,
  writeOutsideSentinel,
  writeTreeFile,
  type PackageArtifactTree,
  type PackageArtifactTreeRegistration,
} from './package-artifact-tree.js';
import { planTypeClosure } from './package-type-closure.js';

export type TypeConsumerKind =
  | 'positive'
  | 'private'
  | 'default'
  | 'alias'
  | 'subpath'
  | 'host-shaped'
  | 'readme-example'
  | 'expanded-example'
  | 'decision-growth'
  | 'reduction-growth';

export type RuntimeConsumerKind =
  | 'runtime'
  | 'private-runtime'
  | 'typed'
  | 'host-shaped'
  | 'readme-example'
  | 'expanded-example'
  | 'permission-read'
  | 'permission-write'
  | 'permission-child'
  | 'permission-worker';

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
  readonly kind: TypeConsumerKind;
}

export interface OwnedRuntimeConsumer {
  readonly [runtimeFixtureBrand]: true;
  readonly kind: RuntimeConsumerKind;
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
  createTypeConsumer(kind: TypeConsumerKind, source: string): OwnedTypeConsumer;
  createRuntimeConsumer(kind: RuntimeConsumerKind, source: string): OwnedRuntimeConsumer;
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
  typeScript(
    access: PackageArtifactAccess,
    fixture: OwnedTypeConsumer,
    expectedDiagnostic?: string,
  ): void;
  executeConsumer(
    access: PackageArtifactAccess,
    fixture: OwnedRuntimeConsumer,
    expectedDiagnostic?: string,
  ): void;
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

const TYPE_PATHS: Readonly<Record<TypeConsumerKind, string>> = {
  positive: 'consumer.ts',
  private: 'private-consumer.ts',
  default: 'default-consumer.ts',
  alias: 'alias-consumer.ts',
  subpath: 'subpath-consumer.ts',
  'host-shaped': 'host-shaped-consumer.ts',
  'readme-example': 'examples/readme-working-root.ts',
  'expanded-example': 'examples/expanded-consumer.ts',
  'decision-growth': 'decision-growth.ts',
  'reduction-growth': 'reduction-growth.ts',
};

const RUNTIME_PATHS: Readonly<Record<RuntimeConsumerKind, string>> = {
  runtime: 'consumer.mjs',
  'private-runtime': 'private-runtime.mjs',
  typed: 'out/consumer.js',
  'host-shaped': 'out/host-shaped-consumer.js',
  'readme-example': 'out/examples/readme-working-root.js',
  'expanded-example': 'out/examples/expanded-consumer.js',
  'permission-read': 'permission-read.mjs',
  'permission-write': 'permission-write.mjs',
  'permission-child': 'permission-child.mjs',
  'permission-worker': 'permission-worker.mjs',
};

const REQUIRED_CAPABILITIES: readonly Exclude<CommandCapability, 'pack'>[] = [
  'publint',
  'attw',
  'extract',
  'typeScript',
  'consumer',
];

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

class PackageArtifactReader {
  readonly access: PackageArtifactAccess;
  readonly #tree: PackageArtifactTree;
  readonly #artifact: PackageArtifact;
  readonly #typeFixtures = new WeakSet<object>();
  readonly #runtimeFixtures = new WeakSet<object>();
  readonly #typePaths = new WeakMap<object, string>();
  readonly #runtimePaths = new WeakMap<object, string>();
  readonly #closureManifest: readonly string[];

  constructor(tree: PackageArtifactTree, artifact: PackageArtifact) {
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
      createTypeConsumer: (kind, source) => this.createTypeConsumer(kind, source),
      createRuntimeConsumer: (kind, source) => this.createRuntimeConsumer(kind, source),
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

  createTypeConsumer(kind: TypeConsumerKind, source: string): OwnedTypeConsumer {
    writeTreeFile(this.#tree, TYPE_PATHS[kind], source);
    const configuration = writeTreeFile(
      this.#tree,
      `tsconfig.${kind}.json`,
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
          include: [TYPE_PATHS[kind]],
        },
        undefined,
        2,
      )}\n`,
    );
    const fixture: OwnedTypeConsumer = Object.freeze({
      [typeFixtureBrand]: true as const,
      kind,
    });
    this.#typeFixtures.add(fixture);
    this.#typePaths.set(fixture, configuration);
    return fixture;
  }

  createRuntimeConsumer(kind: RuntimeConsumerKind, source: string): OwnedRuntimeConsumer {
    const relativePath = RUNTIME_PATHS[kind];
    let entrypoint = runtimeFixturePath(this.#tree, relativePath);
    if (kind.startsWith('permission-')) {
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
      kind,
    });
    this.#runtimeFixtures.add(fixture);
    this.#runtimePaths.set(fixture, entrypoint);
    return fixture;
  }

  configurationPath(fixture: OwnedTypeConsumer): string {
    if (!this.#typeFixtures.has(fixture)) {
      throw new Error('[package-artifact-identity]');
    }
    const path = this.#typePaths.get(fixture);
    if (!path) {
      throw new Error('[package-artifact-identity]');
    }
    return path;
  }

  prepareTypeScript(fixture: OwnedTypeConsumer): (() => void) | undefined {
    if (!this.#typeFixtures.has(fixture)) {
      throw new Error('[package-artifact-identity]');
    }
    if (fixture.kind !== 'decision-growth' && fixture.kind !== 'reduction-growth') {
      return undefined;
    }
    return mutateExhaustivenessDeclaration(this.#tree, fixture.kind);
  }

  runtimeLaunch(fixture: OwnedRuntimeConsumer): RuntimeLaunch {
    if (!this.#runtimeFixtures.has(fixture)) {
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
): PackageCommandRunner => {
  const { owner, tree } = registration;
  let state: 'not-packed' | 'packed' | 'complete' | 'disposed' = 'not-packed';
  let packAttempts = 0;
  let artifact: PackageArtifact | undefined;
  let cleanupError: Error | undefined;
  const artifacts = new WeakMap<object, ArtifactDetails>();
  const readers = new WeakMap<object, PackageArtifactReader>();
  const accesses = new WeakMap<object, PackageArtifactReader>();
  const ledger = new Set<Exclude<CommandCapability, 'pack'>>();

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
  const requireAccess = (candidate: PackageArtifactAccess): PackageArtifactReader => {
    requireActive();
    const reader = accesses.get(candidate);
    if (!reader || readers.get(artifact ?? {}) !== reader) {
      throw new Error('[package-artifact-identity]');
    }
    return reader;
  };
  const run = (capability: CommandCapability, command: Command): unknown => {
    const result = executor(capability, command);
    if (capability !== 'pack') {
      ledger.add(capability);
    }
    return result;
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
      const reader = new PackageArtifactReader(tree, candidate);
      readers.set(candidate, reader);
      accesses.set(reader.access, reader);
      return reader.access;
    },
    typeScript(
      candidate: PackageArtifactAccess,
      fixture: OwnedTypeConsumer,
      expectedDiagnostic?: string,
    ): void {
      const reader = requireAccess(candidate);
      const restore = reader.prepareTypeScript(fixture);
      let failure: unknown;
      try {
        run('typeScript', {
          executable: packageCompilerPath(tree),
          arguments: ['-p', reader.configurationPath(fixture)],
          cwd: tree.root,
          output: 'capture',
        });
      } catch (error: unknown) {
        failure = error;
      } finally {
        restore?.();
      }
      if (expectedDiagnostic === undefined && failure !== undefined) {
        throw failure;
      }
      if (
        expectedDiagnostic !== undefined &&
        (failure === undefined || !failureOutput(failure).includes(expectedDiagnostic))
      ) {
        throw failure ?? new Error(`[package-consumer-diagnostic] Expected ${expectedDiagnostic}`);
      }
    },
    executeConsumer(
      candidate: PackageArtifactAccess,
      fixture: OwnedRuntimeConsumer,
      expectedDiagnostic?: string,
    ): void {
      const reader = requireAccess(candidate);
      const launch = reader.runtimeLaunch(fixture);
      let failure: unknown;
      try {
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
      if (expectedDiagnostic === undefined && failure !== undefined) {
        throw failure;
      }
      if (
        expectedDiagnostic !== undefined &&
        (failure === undefined || !failureOutput(failure).includes(expectedDiagnostic))
      ) {
        throw failure ?? new Error(`[package-consumer-diagnostic] Expected ${expectedDiagnostic}`);
      }
    },
    assertComplete(candidate: PackageArtifactAccess): void {
      requireAccess(candidate);
      if (
        packAttempts !== 1 ||
        !artifact ||
        !REQUIRED_CAPABILITIES.every((item) => ledger.has(item))
      ) {
        throw new Error('[package-runner-incomplete]');
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
): PackageCommandRunner => createRunner(executor, registration);
