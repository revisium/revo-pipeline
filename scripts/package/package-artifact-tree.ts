import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const treeBrand: unique symbol = Symbol('PackageArtifactTree');
const ownerBrand: unique symbol = Symbol('PackageArtifactTreeOwner');
const cleanupBrand: unique symbol = Symbol('PackageCleanupRoot');
const preparedDeclarationBrand: unique symbol = Symbol('PreparedDeclarationMutation');

export interface PackageArtifactTree {
  readonly [treeBrand]: true;
  readonly workspaceRoot: string;
  readonly root: string;
  readonly installedPackageRoot: string;
}

export interface PackageArtifactTreeOwner {
  readonly [ownerBrand]: true;
}

export interface PackageArtifactTreeRegistration {
  readonly owner: PackageArtifactTreeOwner;
  readonly tree: PackageArtifactTree;
}

export interface PreparedDeclarationMutation {
  readonly [preparedDeclarationBrand]: true;
}

export interface DeclarationFileOperations {
  read(path: string): Buffer;
  write(path: string, content: Buffer): void;
}

interface CleanupRoot {
  readonly [cleanupBrand]: true;
  readonly target: string;
  readonly canonicalTarget: string;
  readonly canonicalParent: string;
}

interface TreeRegistration {
  readonly owner: PackageArtifactTreeOwner;
  readonly cleanup: CleanupRoot;
  readonly remove: (path: string) => void;
}

interface LockSnapshot {
  readonly name: string;
  readonly version: string;
  readonly identity: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

export interface InspectedTypeClosureNode {
  readonly name: string;
  readonly version: string;
  readonly sourceId: string;
  readonly manifestDependencies: Readonly<Record<string, string>>;
  readonly snapshotDependencies: Readonly<Record<string, string>>;
}

export interface InspectedTypeClosure {
  readonly rootName: string;
  readonly rootRange: string;
  readonly rootVersion: string;
  readonly nodes: readonly InspectedTypeClosureNode[];
  readonly sources: ReadonlyMap<string, string>;
  readonly storeRoot: string;
}

export interface MaterializationPlanEntry {
  readonly name: string;
  readonly version: string;
  readonly sourceId: string;
}

const registrations = new WeakMap<PackageArtifactTree, TreeRegistration>();
const preparedDeclarations = new WeakMap<
  PreparedDeclarationMutation,
  {
    readonly tree: PackageArtifactTree;
    readonly path: string;
    readonly original: Buffer;
    readonly operations: DeclarationFileOperations;
    restored: boolean;
  }
>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const contained = (root: string, target: string): boolean => {
  const offset = relative(root, target);
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset));
};

const canonicalContained = (root: string, target: string): string => {
  const canonical = realpathSync(target);
  if (!contained(root, canonical)) {
    throw new Error('[package-artifact-boundary]');
  }
  return canonical;
};

const packageDestination = (nodeModules: string, name: string): string => {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(name)) {
    throw new Error('[package-artifact-boundary]');
  }
  return join(nodeModules, ...name.split('/'));
};

const readManifest = (root: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!isRecord(parsed)) {
    throw new Error('[package-type-closure]');
  }
  return parsed;
};

const parseSnapshotKey = (
  key: string,
): { readonly name: string; readonly version: string; readonly identity: string } => {
  const normalized = key.replace(/^'|'$/gu, '');
  const separator = normalized.lastIndexOf('@');
  if (separator <= 0) {
    throw new Error('[package-type-closure]');
  }
  return {
    name: normalized.slice(0, separator),
    version: normalized.slice(separator + 1),
    identity: normalized,
  };
};

const parseLockSnapshots = (source: string): ReadonlyMap<string, readonly LockSnapshot[]> => {
  const snapshots = new Map<string, LockSnapshot[]>();
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === 'snapshots:');
  if (start < 0) {
    throw new Error('[package-type-closure]');
  }
  let current:
    | { name: string; version: string; identity: string; dependencies: Record<string, string> }
    | undefined;
  let dependencies = false;
  const commit = (): void => {
    if (!current) {
      return;
    }
    const values = snapshots.get(current.name) ?? [];
    values.push({
      name: current.name,
      version: current.version,
      identity: current.identity,
      dependencies: Object.freeze({ ...current.dependencies }),
    });
    snapshots.set(current.name, values);
  };
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) {
      break;
    }
    const entry = line.match(/^  (\S.+):(?: \{\})?$/u);
    if (entry?.[1]) {
      commit();
      current = { ...parseSnapshotKey(entry[1]), dependencies: {} };
      dependencies = false;
      continue;
    }
    if (line === '    dependencies:') {
      dependencies = true;
      continue;
    }
    const dependency = dependencies ? line.match(/^      ([^:]+): (.+)$/u) : undefined;
    if (dependency?.[1] && dependency[2] && current) {
      current.dependencies[dependency[1].replace(/^'|'$/gu, '')] = dependency[2].replace(
        /^'|'$/gu,
        '',
      );
    } else if (/^    \S/u.test(line)) {
      dependencies = false;
    }
  }
  commit();
  return snapshots;
};

const importerVersion = (lockSource: string, name: string, range: string): string => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const escapedRange = range.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = lockSource.match(
    new RegExp(
      `^      '${escapedName}':\\n        specifier: ${escapedRange}\\n        version: ([^\\n()]+)(?:\\([^\\n]+\\))?$`,
      'mu',
    ),
  );
  if (!match?.[1]) {
    throw new Error('[package-type-closure]');
  }
  return match[1];
};

const packageContext = (root: string, name: string): string =>
  name.startsWith('@') ? dirname(dirname(root)) : dirname(root);

const snapshotStoreDirectory = (snapshot: LockSnapshot): string => {
  const versionOffset = snapshot.name.length + 1;
  if (
    !snapshot.identity.startsWith(`${snapshot.name}@`) ||
    versionOffset >= snapshot.identity.length
  ) {
    throw new Error('[package-type-closure]');
  }
  return `${snapshot.name.replace('/', '+')}@${snapshot.identity
    .slice(versionOffset)
    .replaceAll('(', '_')
    .replaceAll(')', '_')}`;
};

const snapshotPackageRoot = (storeRoot: string, snapshot: LockSnapshot): string =>
  join(storeRoot, snapshotStoreDirectory(snapshot), 'node_modules', ...snapshot.name.split('/'));

const authenticateSnapshotRoot = (
  storeRoot: string,
  snapshot: LockSnapshot,
  selectedRoot: string,
): string => {
  const selected = canonicalContained(storeRoot, selectedRoot);
  let expected: string;
  try {
    expected = canonicalContained(storeRoot, snapshotPackageRoot(storeRoot, snapshot));
  } catch (error: unknown) {
    if (error instanceof Error && error.message === '[package-artifact-boundary]') {
      throw new Error('[package-type-closure]', { cause: error });
    }
    throw error;
  }
  if (selected !== expected) {
    throw new Error('[package-type-closure]');
  }
  return selected;
};

const inspectClosure = (workspaceRoot: string): InspectedTypeClosure => {
  const workspaceManifest = readManifest(workspaceRoot);
  const rootRange = isRecord(workspaceManifest['devDependencies'])
    ? workspaceManifest['devDependencies']['@types/node']
    : undefined;
  if (typeof rootRange !== 'string') {
    throw new Error('[package-type-closure]');
  }
  const lockSource = readFileSync(join(workspaceRoot, 'pnpm-lock.yaml'), 'utf8');
  const rootVersion = importerVersion(lockSource, '@types/node', rootRange);
  const snapshots = parseLockSnapshots(lockSource);
  const storeRoot = realpathSync(join(workspaceRoot, 'node_modules/.pnpm'));
  const rootLink = join(workspaceRoot, 'node_modules/@types/node');
  const nodes: InspectedTypeClosureNode[] = [];
  const sources = new Map<string, string>();
  const selected = new Map<string, string>();

  const visit = (name: string, version: string, sourceRoot: string): void => {
    const matches = (snapshots.get(name) ?? []).filter((snapshot) => snapshot.version === version);
    if (matches.length !== 1 || !matches[0]) {
      throw new Error('[package-type-closure]');
    }
    const snapshot = matches[0];
    const canonicalRoot = authenticateSnapshotRoot(storeRoot, snapshot, sourceRoot);
    const previous = selected.get(name);
    if (previous) {
      if (previous !== version) {
        throw new Error('[package-type-closure]');
      }
      return;
    }
    const manifest = readManifest(canonicalRoot);
    if (manifest['name'] !== name || manifest['version'] !== version) {
      throw new Error('[package-type-closure]');
    }
    const rawDependencies = isRecord(manifest['dependencies']) ? manifest['dependencies'] : {};
    const dependencies: Record<string, string> = {};
    for (const [dependencyName, range] of Object.entries(rawDependencies)) {
      if (typeof range !== 'string') {
        throw new Error('[package-type-closure]');
      }
      dependencies[dependencyName] = range;
    }
    const sourceId = `${name}@${version}`;
    selected.set(name, version);
    sources.set(sourceId, canonicalRoot);
    nodes.push({
      name,
      version,
      sourceId,
      manifestDependencies: Object.freeze({ ...dependencies }),
      snapshotDependencies: snapshot.dependencies,
    });
    for (const dependencyName of Object.keys(dependencies).sort()) {
      const childVersion = snapshot.dependencies[dependencyName];
      if (typeof childVersion !== 'string') {
        throw new Error('[package-type-closure]');
      }
      const childLink = packageDestination(packageContext(canonicalRoot, name), dependencyName);
      let childRoot: string;
      try {
        childRoot = canonicalContained(storeRoot, childLink);
      } catch (error: unknown) {
        if (error instanceof Error && error.message === '[package-artifact-boundary]') {
          throw error;
        }
        throw new Error('[package-type-closure]', { cause: error });
      }
      visit(dependencyName, childVersion, childRoot);
    }
  };

  visit('@types/node', rootVersion, rootLink);
  return {
    rootName: '@types/node',
    rootRange,
    rootVersion,
    nodes: Object.freeze(nodes),
    sources,
    storeRoot,
  };
};

const destinationStatus = (path: string): ReturnType<typeof lstatSync> | undefined => {
  try {
    return lstatSync(path);
  } catch (error: unknown) {
    if (isRecord(error) && error['code'] === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

export const destinationPathComponentsForTest = (
  relativePath: string,
  separator = sep,
): readonly string[] =>
  Object.freeze(relativePath.split(separator).filter((component) => component.length > 0));

const validateDestinationPath = (root: string, target: string): void => {
  const resolved = resolve(target);
  if (!contained(root, resolved)) {
    throw new Error('[package-artifact-boundary]');
  }
  const relativeTarget = relative(root, resolved);
  let current = root;
  for (const segment of destinationPathComponentsForTest(relativeTarget)) {
    current = join(current, segment);
    const status = destinationStatus(current);
    if (!status) {
      continue;
    }
    if (status.isSymbolicLink()) {
      throw new Error('[package-isolation-symlink]');
    }
    if (!status.isDirectory()) {
      throw new Error('[package-isolation-entry]');
    }
    canonicalContained(root, current);
  }
};

const validateDestinationFile = (root: string, target: string, mustBeMissing: boolean): void => {
  validateDestinationPath(root, dirname(target));
  const status = destinationStatus(target);
  if (!status) {
    if (!mustBeMissing) {
      throw new Error('[package-artifact-boundary]');
    }
    return;
  }
  if (status.isSymbolicLink()) {
    throw new Error('[package-isolation-symlink]');
  }
  if (mustBeMissing) {
    throw new Error('[package-artifact-boundary]');
  }
  if (!status.isFile()) {
    throw new Error('[package-isolation-entry]');
  }
  canonicalContained(root, target);
};

const prepareDestinationDirectory = (root: string, destination: string): void => {
  validateDestinationPath(root, destination);
  mkdirSync(destination, { recursive: true });
  validateDestinationPath(root, destination);
};

const auditCopyTree = (
  source: string,
  destination: string,
  storeRoot: string,
  root: string,
): void => {
  const canonicalSource = canonicalContained(storeRoot, source);
  validateDestinationPath(root, destination);
  for (const entry of readdirSync(canonicalSource, { withFileTypes: true })) {
    const sourceEntry = join(canonicalSource, entry.name);
    const destinationEntry = join(destination, entry.name);
    const status = lstatSync(sourceEntry);
    if (status.isSymbolicLink()) {
      throw new Error('[package-isolation-symlink]');
    }
    if (status.isDirectory()) {
      auditCopyTree(sourceEntry, destinationEntry, storeRoot, root);
    } else if (status.isFile()) {
      validateDestinationFile(root, destinationEntry, true);
    } else {
      throw new Error('[package-isolation-entry]');
    }
  }
};

const copyRealTree = (
  source: string,
  destination: string,
  storeRoot: string,
  root: string,
): void => {
  const canonicalSource = canonicalContained(storeRoot, source);
  prepareDestinationDirectory(root, destination);
  for (const entry of readdirSync(canonicalSource, { withFileTypes: true })) {
    const sourceEntry = join(canonicalSource, entry.name);
    const destinationEntry = join(destination, entry.name);
    const status = lstatSync(sourceEntry);
    if (status.isSymbolicLink()) {
      throw new Error('[package-isolation-symlink]');
    }
    if (status.isDirectory()) {
      copyRealTree(sourceEntry, destinationEntry, storeRoot, root);
    } else if (status.isFile()) {
      validateDestinationFile(root, destinationEntry, true);
      copyFileSync(sourceEntry, destinationEntry);
      validateDestinationFile(root, destinationEntry, false);
    } else {
      throw new Error('[package-isolation-entry]');
    }
  }
};

const defaultRemove = (path: string): void => rmSync(path, { recursive: true, force: false });

const cleanupConstructionFailure = (target: string, remove: (path: string) => void): unknown => {
  try {
    remove(target);
    return undefined;
  } catch (error: unknown) {
    return error;
  }
};

const createTree = (
  workspaceRoot: string,
  remove: (path: string) => void,
): PackageArtifactTreeRegistration => {
  const canonicalWorkspace = realpathSync(workspaceRoot);
  const canonicalParent = realpathSync(tmpdir());
  const target = mkdtempSync(join(canonicalParent, 'revo-pipeline-package-'));
  try {
    const canonicalTarget = realpathSync(target);
    const root = join(canonicalTarget, 'consumer');
    const installedPackageRoot = join(root, 'node_modules/@revisium/revo-pipeline');
    mkdirSync(join(canonicalTarget, 'package'));
    mkdirSync(root);
    const tree: PackageArtifactTree = Object.freeze({
      [treeBrand]: true as const,
      workspaceRoot: canonicalWorkspace,
      root,
      installedPackageRoot,
    });
    const owner: PackageArtifactTreeOwner = Object.freeze({
      [ownerBrand]: true as const,
    });
    const cleanup: CleanupRoot = Object.freeze({
      [cleanupBrand]: true as const,
      target,
      canonicalTarget,
      canonicalParent,
    });
    registrations.set(tree, { owner, cleanup, remove });
    return Object.freeze({ owner, tree });
  } catch (error: unknown) {
    const cleanupError = cleanupConstructionFailure(target, remove);
    if (cleanupError !== undefined) {
      throw new Error('[package-cleanup]', {
        cause: error,
      });
    }
    throw error;
  }
};

export const createPackageArtifactTree = (workspaceRoot: string): PackageArtifactTreeRegistration =>
  createTree(workspaceRoot, defaultRemove);

export const createPackageArtifactTreeForTest = (
  workspaceRoot: string,
  remove: (path: string) => void,
): PackageArtifactTreeRegistration => createTree(workspaceRoot, remove);

export const cleanupPackageArtifactTree = (
  owner: PackageArtifactTreeOwner,
  tree: PackageArtifactTree,
): void => {
  const registration = registrations.get(tree);
  if (!registration || registration.owner !== owner) {
    throw new Error('[package-cleanup]');
  }
  registrations.delete(tree);
  const { cleanup, remove } = registration;
  try {
    const status = lstatSync(cleanup.target);
    const canonicalTarget = realpathSync(cleanup.target);
    const workspace = realpathSync(tree.workspaceRoot);
    const cwd = realpathSync(process.cwd());
    const filesystemRoot = resolve(cleanup.target, '/');
    if (
      status.isSymbolicLink() ||
      canonicalTarget !== cleanup.canonicalTarget ||
      dirname(canonicalTarget) !== cleanup.canonicalParent ||
      [workspace, cwd, filesystemRoot].includes(canonicalTarget) ||
      contained(canonicalTarget, workspace) ||
      contained(canonicalTarget, cwd) ||
      contained(workspace, canonicalTarget) ||
      contained(cwd, canonicalTarget)
    ) {
      throw new Error('[package-cleanup]');
    }
    remove(cleanup.target);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === '[package-cleanup]') {
      throw error;
    }
    throw new Error('[package-cleanup]', { cause: error });
  }
};

export const packageArchiveDirectory = (tree: PackageArtifactTree): string =>
  join(dirname(tree.root), 'package');

export const packageArchivePath = (tree: PackageArtifactTree, filename: string): string => {
  if (filename !== filename.split('/').at(-1) || filename.includes('\\')) {
    throw new Error('[package-artifact-boundary]');
  }
  return join(packageArchiveDirectory(tree), filename);
};

export const packageCompilerPath = (tree: PackageArtifactTree): string =>
  join(tree.workspaceRoot, 'node_modules/.bin/tsc');

export const packageCachePath = (tree: PackageArtifactTree): string =>
  join(dirname(tree.root), 'npm-cache');

export const runtimeFixturePath = (tree: PackageArtifactTree, relativePath: string): string => {
  const target = resolve(tree.root, relativePath);
  if (isAbsolute(relativePath) || !contained(tree.root, target)) {
    throw new Error('[package-artifact-boundary]');
  }
  return target;
};

export const permissionFixturePaths = (
  tree: PackageArtifactTree,
): { readonly outside: string; readonly inside: string } =>
  Object.freeze({
    outside: join(tree.root, '..', 'outside-sentinel'),
    inside: join(tree.root, 'inside-write'),
  });

export const writeOutsideSentinel = (tree: PackageArtifactTree): void => {
  writeFileSync(permissionFixturePaths(tree).outside, 'outside');
};

export const ensureExtractionRoot = (tree: PackageArtifactTree): void => {
  mkdirSync(tree.installedPackageRoot, { recursive: true });
};

export const inspectTypeClosure = (tree: PackageArtifactTree): InspectedTypeClosure =>
  inspectClosure(tree.workspaceRoot);

export const materializeTypeClosure = (
  tree: PackageArtifactTree,
  inspection: InspectedTypeClosure,
  plan: readonly MaterializationPlanEntry[],
): void => {
  const { sources, storeRoot } = inspection;
  const nodeModules = join(tree.root, 'node_modules');
  const destinations = plan.map(({ name }) => packageDestination(nodeModules, name));
  const uniqueDestinations = new Set(destinations);
  if (
    uniqueDestinations.size !== destinations.length ||
    destinations.some((destination, index) =>
      destinations.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index && contained(destination, candidate),
      ),
    )
  ) {
    throw new Error('[package-artifact-boundary]');
  }
  for (const destination of destinations) {
    validateDestinationPath(tree.root, destination);
  }
  const expectedEntries = new Set(
    inspection.nodes.map(({ name, version, sourceId }) => `${name}\0${version}\0${sourceId}`),
  );
  const suppliedEntries = new Set(
    plan.map(({ name, version, sourceId }) => `${name}\0${version}\0${sourceId}`),
  );
  if (
    expectedEntries.size !== suppliedEntries.size ||
    [...expectedEntries].some((entry) => !suppliedEntries.has(entry))
  ) {
    throw new Error('[package-type-closure]');
  }
  for (const entry of plan) {
    const source = sources.get(entry.sourceId);
    if (!source) {
      throw new Error('[package-type-closure]');
    }
    auditCopyTree(source, packageDestination(nodeModules, entry.name), storeRoot, tree.root);
  }
  for (const entry of plan) {
    const source = sources.get(entry.sourceId);
    if (!source) {
      throw new Error('[package-type-closure]');
    }
    copyRealTree(source, packageDestination(nodeModules, entry.name), storeRoot, tree.root);
  }
  assertExactMaterialization(tree, plan);
};

export const assertExactMaterialization = (
  tree: PackageArtifactTree,
  plan: readonly MaterializationPlanEntry[],
): void => {
  const expected = new Set(plan.map(({ name }) => name));
  const nodeModules = join(tree.root, 'node_modules');
  const actual = new Set<string>();
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name === '@revisium') {
      continue;
    }
    if (entry.name.startsWith('@')) {
      for (const child of readdirSync(join(nodeModules, entry.name))) {
        actual.add(`${entry.name}/${child}`);
      }
    } else {
      actual.add(entry.name);
    }
  }
  if (actual.size !== expected.size || [...actual].some((name) => !expected.has(name))) {
    throw new Error('[package-type-closure]');
  }
};

export const writeTreeFile = (
  tree: PackageArtifactTree,
  relativePath: string,
  source: string,
): string => {
  const target = resolve(tree.root, relativePath);
  if (isAbsolute(relativePath) || !contained(tree.root, target)) {
    throw new Error('[package-artifact-boundary]');
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
  return target;
};

export const readTreeFile = (tree: PackageArtifactTree, relativePath: string): string => {
  const target = resolve(tree.root, relativePath);
  if (isAbsolute(relativePath) || !contained(tree.root, target)) {
    throw new Error('[package-artifact-boundary]');
  }
  return readFileSync(canonicalContained(tree.root, target), 'utf8');
};

export const expectedPackageEntryUrl = (tree: PackageArtifactTree): string =>
  pathToFileURL(join(tree.installedPackageRoot, 'dist/index.js')).href;

const declarationMutationPath = (
  tree: PackageArtifactTree,
  kind: 'decision-growth' | 'reduction-growth',
): string =>
  join(
    tree.installedPackageRoot,
    kind === 'decision-growth'
      ? 'dist/errors/pipeline-decision.d.ts'
      : 'dist/errors/pipeline-reduction.d.ts',
  );

const mutatedDeclaration = (
  original: string,
  kind: 'decision-growth' | 'reduction-growth',
): string => {
  const mutated =
    kind === 'decision-growth'
      ? original.replace(
          ' | RejectDecision;',
          " | RejectDecision | { readonly kind: 'future-decision' };",
        )
      : original.replace(
          '}) | {',
          "}) | (PipelineReductionSuccessBase & { readonly status: 'future-reduction'; readonly wait: null; readonly terminal: null }) | {",
        );
  if (mutated === original) {
    throw new Error('[package-artifact-boundary]');
  }
  return mutated;
};

const restorationMismatch = (primary: unknown): Error =>
  new Error('[package-typescript-restore]', { cause: primary });

const preparationAndRestorationFailure = (primary: unknown, restore: unknown): AggregateError =>
  new AggregateError([primary, restore], '[package-typescript-prepare-and-restore]', {
    cause: primary,
  });

const restorePreparedDeclaration = (
  tree: PackageArtifactTree,
  prepared: PreparedDeclarationMutation,
): void => {
  const details = preparedDeclarations.get(prepared);
  if (!details || details.tree !== tree || details.restored) {
    throw new Error('[package-artifact-identity]');
  }
  details.restored = true;
  details.operations.write(details.path, details.original);
  if (!details.operations.read(details.path).equals(details.original)) {
    throw new Error('[package-typescript-restore]');
  }
};

const nodeDeclarationFileOperations: DeclarationFileOperations = Object.freeze({
  read: (path: string) => readFileSync(path),
  write: (path: string, content: Buffer) => writeFileSync(path, content),
});

const prepareDeclaration = (
  tree: PackageArtifactTree,
  kind: 'decision-growth' | 'reduction-growth',
  operations: DeclarationFileOperations,
): PreparedDeclarationMutation => {
  const path = declarationMutationPath(tree, kind);
  let original: Buffer | undefined;
  let mutationWriteAttempted = false;
  try {
    original = operations.read(path);
    const mutated = Buffer.from(mutatedDeclaration(original.toString('utf8'), kind));
    mutationWriteAttempted = true;
    operations.write(path, mutated);
    if (!operations.read(path).equals(mutated)) {
      throw new Error('[package-artifact-boundary]');
    }
    const prepared: PreparedDeclarationMutation = Object.freeze({
      [preparedDeclarationBrand]: true as const,
    });
    preparedDeclarations.set(prepared, { tree, path, original, operations, restored: false });
    return prepared;
  } catch (primary: unknown) {
    if (!original || !mutationWriteAttempted) {
      throw primary;
    }
    try {
      operations.write(path, original);
      if (!operations.read(path).equals(original)) {
        throw restorationMismatch(primary);
      }
    } catch (restore: unknown) {
      throw preparationAndRestorationFailure(primary, restore);
    }
    throw primary;
  }
};

export const prepareExhaustivenessDeclaration = (
  tree: PackageArtifactTree,
  kind: 'decision-growth' | 'reduction-growth',
): PreparedDeclarationMutation => prepareDeclaration(tree, kind, nodeDeclarationFileOperations);

export const prepareExhaustivenessDeclarationForTest = (
  tree: PackageArtifactTree,
  kind: 'decision-growth' | 'reduction-growth',
  operations: DeclarationFileOperations,
): PreparedDeclarationMutation => prepareDeclaration(tree, kind, operations);

export const restoreExhaustivenessDeclaration = (
  tree: PackageArtifactTree,
  prepared: PreparedDeclarationMutation,
): void => restorePreparedDeclaration(tree, prepared);

export const assertPackageResolution = (
  tree: PackageArtifactTree,
  deniedSubpath?: string,
): void => {
  const manifest = readManifest(tree.installedPackageRoot);
  const exports = manifest['exports'];
  if (deniedSubpath) {
    if (isRecord(exports) && !Object.hasOwn(exports, `.${deniedSubpath}`)) {
      return;
    }
    throw new Error('[package-artifact-boundary]');
  }
  const rootExport = isRecord(exports) ? exports['.'] : undefined;
  const importTarget = isRecord(rootExport) ? rootExport['import'] : undefined;
  if (manifest['name'] !== '@revisium/revo-pipeline' || typeof importTarget !== 'string') {
    throw new Error('[package-artifact-boundary]');
  }
  const resolved = canonicalContained(
    tree.installedPackageRoot,
    join(tree.installedPackageRoot, importTarget),
  );
  if (resolved !== realpathSync(join(tree.installedPackageRoot, 'dist/index.js'))) {
    throw new Error('[package-artifact-boundary]');
  }
};

export const auditPackageArtifactTree = (tree: PackageArtifactTree, entrypoint: string): void => {
  const rootStatus = lstatSync(tree.root);
  if (rootStatus.isSymbolicLink()) {
    throw new Error('[package-isolation-symlink]');
  }
  if (!rootStatus.isDirectory()) {
    throw new Error('[package-isolation-entry]');
  }
  const canonicalRoot = realpathSync(tree.root);
  if (canonicalRoot !== tree.root) {
    throw new Error('[package-artifact-boundary]');
  }
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const status = lstatSync(path);
      if (status.isSymbolicLink()) {
        throw new Error('[package-isolation-symlink]');
      }
      if (status.isDirectory()) {
        canonicalContained(canonicalRoot, path);
        walk(path);
      } else if (status.isFile()) {
        canonicalContained(canonicalRoot, path);
      } else {
        throw new Error('[package-isolation-entry]');
      }
    }
  };
  walk(canonicalRoot);
  const entrypointStatus = lstatSync(entrypoint);
  const packageStatus = lstatSync(tree.installedPackageRoot);
  if (entrypointStatus.isSymbolicLink() || packageStatus.isSymbolicLink()) {
    throw new Error('[package-isolation-symlink]');
  }
  if (!entrypointStatus.isFile() || !packageStatus.isDirectory()) {
    throw new Error('[package-isolation-entry]');
  }
  canonicalContained(canonicalRoot, entrypoint);
  canonicalContained(canonicalRoot, tree.installedPackageRoot);
  assertPackageResolution(tree);
};
