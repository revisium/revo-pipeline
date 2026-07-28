import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

import * as ts from 'typescript/unstable/ast';
import { SyntaxKind, type Node, type SourceFile } from 'typescript/unstable/ast';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API } from 'typescript/unstable/sync';

const PATHS = {
  verifier: 'scripts/verify-package.ts',
  catalog: 'scripts/package/package-consumer-catalog.ts',
  documentation: 'scripts/package/package-documentation-examples.ts',
  runner: 'scripts/package/package-command-runner.ts',
  tree: 'scripts/package/package-artifact-tree.ts',
  closure: 'scripts/package/package-type-closure.ts',
  fixtures: 'scripts/package/package-consumer-fixtures.ts',
  moduleStructure: 'scripts/architecture/validate-module-structure.ts',
  retiredReader: 'scripts/package/package-artifact-reader.ts',
} as const;

const PRODUCTION_FILES: readonly string[] = Object.freeze([
  PATHS.verifier,
  PATHS.catalog,
  PATHS.documentation,
  PATHS.runner,
  PATHS.tree,
  PATHS.closure,
  PATHS.fixtures,
]);

const PACKAGE_FILES = Object.freeze(
  PRODUCTION_FILES.filter((path) => path.startsWith('scripts/package/')).map((path) =>
    path.slice('scripts/package/'.length),
  ),
);

const fail = (rule: string): never => {
  throw new Error(`[${rule}]`);
};

const specifierText = (node: Node | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

const localTarget = (path: string, specifier: string): string | undefined => {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  if (!specifier.endsWith('.js')) {
    fail('package-verifier-flow-unproven');
  }
  return normalize(join(dirname(path), specifier.replace(/\.js$/u, '.ts'))).replaceAll('\\', '/');
};

const localImports = (path: string, sourceFile: SourceFile): readonly string[] => {
  const imports: string[] = [];
  const append = (node: Node | undefined): void => {
    const specifier = specifierText(node);
    if (specifier === undefined) {
      return fail('package-verifier-flow-unproven');
    }
    const target = localTarget(path, specifier);
    if (target) {
      imports.push(target);
    }
  };
  const visit = (node: Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      append(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (
        ts.isExternalModuleReference(node.moduleReference) &&
        localTarget(path, specifierText(node.moduleReference.expression) ?? '') !== undefined
      ) {
        fail('package-verifier-flow-unproven');
      }
    } else if (ts.isCallExpression(node)) {
      if (
        node.expression.kind === SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'require')
      ) {
        fail('package-verifier-flow-unproven');
      }
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      append(node.argument.literal);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return Object.freeze(imports);
};

const parsedSources = (
  sources: Readonly<Record<string, string>>,
): ReadonlyMap<string, SourceFile> => {
  const virtualRoot = '/package-verifier-flow';
  const configPath = `${virtualRoot}/tsconfig.json`;
  const files: Record<string, string> = {
    [configPath]: JSON.stringify({ files: Object.keys(sources) }),
  };
  for (const [path, source] of Object.entries(sources)) {
    files[`${virtualRoot}/${path}`] = source;
  }
  const api = new API({ cwd: virtualRoot, fs: createVirtualFileSystem(files) });
  try {
    const project = api.updateSnapshot({ openProjects: [configPath] }).getProjects()[0];
    if (!project) {
      return fail('package-verifier-flow-unproven');
    }
    const parsed = new Map<string, SourceFile>();
    for (const path of Object.keys(sources)) {
      const sourceFile = project.program.getSourceFile(`${virtualRoot}/${path}`);
      if (!sourceFile) {
        return fail('package-verifier-flow-unproven');
      }
      parsed.set(path, sourceFile);
    }
    return parsed;
  } finally {
    api.close();
  }
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

const requireOrdered = (source: string, fragments: readonly string[], rule: string): void => {
  let offset = -1;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, offset + 1);
    if (next < 0) {
      fail(rule);
    }
    offset = next;
  }
};

export const validatePackageVerifierFlow = (root: string): void => {
  if (existsSync(join(root, PATHS.retiredReader))) {
    fail('package-reader-boundary');
  }
  let verifier: string;
  let catalog: string;
  let documentation: string;
  let runner: string;
  let tree: string;
  let closure: string;
  let fixtures: string;
  let moduleStructure: string;
  try {
    verifier = readFileSync(join(root, PATHS.verifier), 'utf8');
    catalog = readFileSync(join(root, PATHS.catalog), 'utf8');
    documentation = readFileSync(join(root, PATHS.documentation), 'utf8');
    runner = readFileSync(join(root, PATHS.runner), 'utf8');
    tree = readFileSync(join(root, PATHS.tree), 'utf8');
    closure = readFileSync(join(root, PATHS.closure), 'utf8');
    fixtures = readFileSync(join(root, PATHS.fixtures), 'utf8');
    moduleStructure = readFileSync(join(root, PATHS.moduleStructure), 'utf8');
  } catch {
    return fail('package-verifier-flow-unproven');
  }
  const actualPackageFiles = readdirSync(join(root, 'scripts/package'))
    .filter((path) => path.endsWith('.ts'))
    .sort();
  sameMembers(actualPackageFiles, PACKAGE_FILES, 'package-verifier-flow-unproven');
  const sourceFiles = parsedSources({
    [PATHS.verifier]: verifier,
    [PATHS.catalog]: catalog,
    [PATHS.documentation]: documentation,
    [PATHS.runner]: runner,
    [PATHS.tree]: tree,
    [PATHS.closure]: closure,
    [PATHS.fixtures]: fixtures,
    [PATHS.moduleStructure]: moduleStructure,
  });
  const importsOf = (path: string): readonly string[] => {
    const sourceFile = sourceFiles.get(path);
    if (!sourceFile) {
      return fail('package-verifier-flow-unproven');
    }
    return localImports(path, sourceFile);
  };
  sameMembers(importsOf(PATHS.catalog), [], 'package-verifier-flow-unproven');
  sameMembers(importsOf(PATHS.documentation), [PATHS.catalog], 'package-verifier-flow-unproven');
  sameMembers(importsOf(PATHS.fixtures), [], 'package-verifier-flow-unproven');
  sameMembers(importsOf(PATHS.closure), [], 'package-verifier-flow-unproven');
  sameMembers(importsOf(PATHS.tree), [], 'package-verifier-flow-unproven');
  sameMembers(
    importsOf(PATHS.runner),
    [PATHS.tree, PATHS.catalog, PATHS.closure],
    'package-verifier-flow-unproven',
  );
  sameMembers(
    importsOf(PATHS.verifier),
    [PATHS.moduleStructure, PATHS.runner, PATHS.catalog, PATHS.fixtures, PATHS.documentation],
    'package-verifier-flow-unproven',
  );
  if (importsOf(PATHS.moduleStructure).some((path) => PRODUCTION_FILES.includes(path))) {
    fail('package-verifier-flow-unproven');
  }
  if (
    tree.includes("from './package-type-closure.js'") ||
    runner.includes("from './package-consumer-fixtures.js'") ||
    catalog.trimStart().startsWith('import ') ||
    /from 'node:(?:fs|path|url|child_process)'/u.test(documentation)
  ) {
    fail('package-verifier-flow-unproven');
  }

  requireOnce(
    runner,
    "import { execFileSync } from 'node:child_process';",
    'package-subprocess-boundary',
  );
  if (
    occurrences(
      `${verifier}\n${catalog}\n${documentation}\n${runner}\n${tree}\n${closure}`,
      "from 'node:child_process'",
    ) !== 1 ||
    occurrences(
      `${verifier}\n${catalog}\n${documentation}\n${runner}\n${tree}\n${closure}`,
      'execFileSync(',
    ) !== 1
  ) {
    fail('package-subprocess-boundary');
  }
  for (const source of [catalog, documentation, runner, closure]) {
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
    if (
      `${catalog}\n${documentation}\n${runner}\n${tree}\n${closure}\n${fixtures}`.includes(
        forbidden,
      )
    ) {
      fail('package-reader-boundary');
    }
  }
  if (
    verifier.includes('const definition = definePipeline(') ||
    verifier.includes('const assertNever = (value: never)')
  ) {
    fail('package-fixture-boundary');
  }
  if (
    !catalog.includes('PACKAGE_CONSUMER_CASES') ||
    !catalog.includes('assertConsumerComplete') ||
    !documentation.includes('extractDocumentationExamples') ||
    runner.includes('const TYPE_PATHS') ||
    runner.includes('const RUNTIME_PATHS')
  ) {
    fail('package-catalog-boundary');
  }
  const typeFlow = runner.slice(
    runner.indexOf('typeScript(candidate:'),
    runner.indexOf('executeConsumer(candidate:'),
  );
  requireOrdered(
    typeFlow,
    [
      'reader.typeCaseId(fixture)',
      'authorizeConsumerEvent(',
      'reader.prepareTypeScript(fixture)',
      "run('typeScript'",
      'reader.restoreTypeScript(prepared)',
      'poisonConsumerCompletion(',
      'commitEvent(',
    ],
    'package-consumer-lifecycle',
  );
  const runtimeFlow = runner.slice(
    runner.indexOf('executeConsumer(candidate:'),
    runner.indexOf('assertComplete(candidate:'),
  );
  requireOrdered(
    runtimeFlow,
    [
      'reader.runtimeCaseId(fixture)',
      'authorizeConsumerEvent(',
      'reader.runtimeLaunch(fixture)',
      "run('consumer'",
      'failConsumer(failure)',
      'commitEvent(',
    ],
    'package-consumer-lifecycle',
  );
  if (
    fixtures.includes('CONSUMER_FIXTURE_DESCRIPTORS') ||
    tree.includes('mutateExhaustivenessDeclaration')
  ) {
    fail('package-catalog-boundary');
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
