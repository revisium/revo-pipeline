import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PATHS = {
  verifier: 'scripts/verify-package.ts',
  runner: 'scripts/package/package-command-runner.ts',
  tree: 'scripts/package/package-artifact-tree.ts',
  closure: 'scripts/package/package-type-closure.ts',
  fixtures: 'scripts/package/package-consumer-fixtures.ts',
  retiredReader: 'scripts/package/package-artifact-reader.ts',
} as const;

const fail = (rule: string): never => {
  throw new Error(`[${rule}]`);
};

const occurrences = (source: string, value: string): number => source.split(value).length - 1;

const requireOnce = (source: string, value: string, rule: string): void => {
  if (occurrences(source, value) !== 1) {
    fail(rule);
  }
};

const interfaceMethods = (source: string, name: string): readonly string[] => {
  const body = source.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (!body) {
    return fail('package-command-capability');
  }
  return [...body.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\(/gmu)].map((match) => match[1] ?? '');
};

const sameMembers = (
  actual: readonly string[],
  expected: readonly string[],
  rule: string,
): void => {
  if ([...actual].sort().join(',') !== [...expected].sort().join(',')) {
    fail(rule);
  }
};

export const validatePackageVerifierFlow = (root: string): void => {
  if (existsSync(join(root, PATHS.retiredReader))) {
    fail('package-reader-boundary');
  }
  let verifier: string;
  let runner: string;
  let tree: string;
  let closure: string;
  let fixtures: string;
  try {
    verifier = readFileSync(join(root, PATHS.verifier), 'utf8');
    runner = readFileSync(join(root, PATHS.runner), 'utf8');
    tree = readFileSync(join(root, PATHS.tree), 'utf8');
    closure = readFileSync(join(root, PATHS.closure), 'utf8');
    fixtures = readFileSync(join(root, PATHS.fixtures), 'utf8');
  } catch {
    return fail('package-verifier-flow-unproven');
  }

  requireOnce(
    verifier,
    "from './package/package-command-runner.js';",
    'package-verifier-flow-unproven',
  );
  requireOnce(
    verifier,
    "from './package/package-consumer-fixtures.js';",
    'package-verifier-flow-unproven',
  );
  requireOnce(runner, "from './package-artifact-tree.js';", 'package-verifier-flow-unproven');
  requireOnce(runner, "from './package-type-closure.js';", 'package-verifier-flow-unproven');
  if (
    tree.includes("from './package-type-closure.js'") ||
    runner.includes("from './package-consumer-fixtures.js'")
  ) {
    fail('package-verifier-flow-unproven');
  }

  requireOnce(
    runner,
    "import { execFileSync } from 'node:child_process';",
    'package-subprocess-boundary',
  );
  if (
    occurrences(`${verifier}\n${runner}\n${tree}\n${closure}`, "from 'node:child_process'") !== 1 ||
    occurrences(`${verifier}\n${runner}\n${tree}\n${closure}`, 'execFileSync(') !== 1
  ) {
    fail('package-subprocess-boundary');
  }
  for (const source of [runner, closure]) {
    if (/from 'node:(?:fs|path|url)'/u.test(source)) {
      fail('package-tree-boundary');
    }
  }
  if (fixtures.trimStart().startsWith('import ')) {
    fail('package-tree-boundary');
  }
  if (
    !tree.includes("from 'node:fs'") ||
    !tree.includes("from 'node:path'") ||
    !tree.includes("from 'node:url'")
  ) {
    fail('package-tree-boundary');
  }
  if (closure.trimStart().startsWith('import ') || fixtures.trimStart().startsWith('import ')) {
    fail('package-verifier-flow-unproven');
  }

  sameMembers(
    interfaceMethods(runner, 'PackageCommandRunner'),
    [
      'pack',
      'publint',
      'attw',
      'extract',
      'prepareArtifact',
      'typeScript',
      'executeConsumer',
      'assertComplete',
      'dispose',
    ],
    'package-command-capability',
  );
  sameMembers(
    interfaceMethods(runner, 'PackageArtifactAccess'),
    [
      'readPackedManifest',
      'readRootDeclaration',
      'readRootRuntimeModule',
      'readPackedFileManifest',
      'readDeclarationManifest',
      'readTypeClosureManifest',
      'createTypeConsumer',
      'createRuntimeConsumer',
      'assertPackageRootResolution',
      'assertDeniedPackageResolution',
    ],
    'package-reader-capability',
  );
  for (const forbidden of [
    'createPackageArtifactReader',
    'export class PackageArtifactReader',
    'readerToken',
    'ArtifactReaderProtocol',
  ]) {
    if (`${runner}\n${tree}\n${closure}\n${fixtures}`.includes(forbidden)) {
      fail('package-reader-boundary');
    }
  }
  if (
    verifier.includes('const definition = definePipeline(') ||
    verifier.includes('const assertNever = (value: never)')
  ) {
    fail('package-fixture-boundary');
  }

  requireOnce(
    verifier,
    'const runner = createPackageCommandRunner();',
    'package-verifier-flow-unproven',
  );
  requireOnce(verifier, 'artifact = runner.pack();', 'package-pack-multiplicity');
  requireOnce(verifier, 'runner.pack()', 'package-pack-multiplicity');
  requireOnce(
    verifier,
    'access = runner.prepareArtifact(packedArtifact);',
    'package-reader-multiplicity',
  );
  requireOnce(verifier, 'runner.assertComplete(preparedAccess);', 'package-verifier-flow-unproven');
  requireOnce(verifier, 'runner.dispose();', 'package-cleanup-flow');
  if (!/\}\s*finally\s*\{\s*try\s*\{\s*runner\.dispose\(\);/u.test(verifier)) {
    fail('package-cleanup-flow');
  }
  const finallyOffset = verifier.indexOf('} finally {');
  const disposeOffset = verifier.indexOf('runner.dispose();');
  if (finallyOffset < 0 || disposeOffset < finallyOffset || /dispose\([^)]/u.test(verifier)) {
    fail('package-cleanup-flow');
  }
  const directFlow = verifier.slice(verifier.indexOf('await runPackageVerificationPhasesForTest'));
  if (
    /(?:const|let|var)\s+alias\s*=\s*(?:runner|access|preparedAccess)\b(?!\.)/u.test(directFlow) ||
    /return\s+(?:runner|access)\b/u.test(directFlow) ||
    /\bhelper\((?:runner|access|preparedAccess)(?:[),])/u.test(directFlow)
  ) {
    fail('package-verifier-flow-unproven');
  }

  for (const fragment of [
    'executable: process.execPath',
    "arguments: ['--permission', `--allow-fs-read=${tree.root}`, launch.entrypoint]",
    'cwd: launch.cwd',
    'environment: {}',
    "stdio: ['ignore', 'pipe', 'pipe']",
    'shell: false',
  ]) {
    if (!runner.includes(fragment)) {
      fail('package-runtime-permission');
    }
  }
  for (const retired of [
    'typescript/unstable/ast',
    'typescript/unstable/fs',
    'typescript/unstable/sync',
    'ownedConsumerSource',
    'createVirtualFileSystem',
  ]) {
    if (`${verifier}\n${runner}\n${tree}`.includes(retired)) {
      fail('package-retired-analyzer');
    }
  }
};
