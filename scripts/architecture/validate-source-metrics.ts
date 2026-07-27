import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import * as ts from 'typescript/unstable/ast';
import { type Node, type SourceFile } from 'typescript/unstable/ast';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API } from 'typescript/unstable/sync';

export interface MetricSource {
  readonly path: string;
  readonly source: string;
}

export type SourceMetricRule = 'production-callable-span' | 'production-leaf-span';
export type SourceMetricPhase = 'PR4a' | 'PR4b' | 'PR4c';

const MAX_FILE_LINES = 250;
const MAX_CALLABLE_LINES = 80;
export const ADVISORY_CALLABLE_LINES = 60;

const formattedSource = (module: MetricSource): string =>
  execFileSync(join(process.cwd(), 'node_modules/.bin/oxfmt'), ['--stdin-filepath', module.path], {
    encoding: 'utf8',
    input: module.source,
  });

const isDefinitionLeaf = (path: string): boolean =>
  path.startsWith('src/definition/') && path.endsWith('.ts') && path !== 'src/definition/index.ts';

const isCompiledIntegrityLeaf = (path: string): boolean =>
  (path.startsWith('src/transition/compiled/') && path.endsWith('.ts')) ||
  path === 'src/transition/validate-compiled-pipeline.ts';
const isTransitionLeaf = (path: string): boolean =>
  path.startsWith('src/transition/') && path.endsWith('.ts') && path !== 'src/transition/index.ts';

export const sourceMetricScope = (
  modules: readonly MetricSource[],
  phase: SourceMetricPhase,
): readonly string[] =>
  modules
    .map((module) => module.path)
    .filter(
      phase === 'PR4a'
        ? isDefinitionLeaf
        : phase === 'PR4b'
          ? isCompiledIntegrityLeaf
          : isTransitionLeaf,
    )
    .sort();

const lineCount = (source: string): number => {
  const withoutTerminalNewline = source.replace(/\r?\n$/u, '');
  return withoutTerminalNewline === '' ? 0 : withoutTerminalNewline.split(/\r?\n/u).length;
};

const callableSpan = (sourceFile: SourceFile, node: Node): number => {
  const first = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  const last = sourceFile.getLineAndCharacterOfPosition(node.end).line;
  return last - first + 1;
};

const fail = (rule: SourceMetricRule, path: string, span: number): never => {
  throw new Error(`[${rule}] ${path}: ${span} lines`);
};

const isRuntimeCallable = (node: Node): boolean => {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.body !== undefined;
  }
  return ts.isFunctionExpression(node) || ts.isArrowFunction(node);
};

const validateCallables = (path: string, sourceFile: SourceFile): void => {
  const visit = (node: Node): void => {
    if (isRuntimeCallable(node) && callableSpan(sourceFile, node) > MAX_CALLABLE_LINES) {
      fail('production-callable-span', path, callableSpan(sourceFile, node));
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
};

export const validateSourceMetrics = (
  modules: readonly MetricSource[],
  productionScope: readonly string[],
): void => {
  if (new Set(productionScope).size !== productionScope.length) {
    throw new Error('[production-metric-scope] duplicate production path');
  }
  const modulePaths = new Set(modules.map((module) => module.path));
  const unknownPath = productionScope.find((path) => !modulePaths.has(path));
  if (unknownPath !== undefined) {
    throw new Error(`[production-metric-scope] unknown production path: ${unknownPath}`);
  }
  const scoped = modules
    .filter((module) => productionScope.includes(module.path))
    .map((module) => ({ ...module, source: formattedSource(module) }));
  if (scoped.length === 0) {
    return;
  }

  const virtualRoot = '/source-metrics';
  const configPath = `${virtualRoot}/tsconfig.json`;
  const files: Record<string, string> = {
    [configPath]: JSON.stringify({ files: scoped.map((module) => module.path) }),
  };
  for (const module of scoped) {
    files[`${virtualRoot}/${module.path}`] = module.source;
  }

  const api = new API({ cwd: virtualRoot, fs: createVirtualFileSystem(files) });
  try {
    const project = api.updateSnapshot({ openProjects: [configPath] }).getProjects()[0];
    if (!project) {
      throw new Error('TypeScript did not create the source-metrics project.');
    }
    for (const module of scoped) {
      const sourceFile = project.program.getSourceFile(`${virtualRoot}/${module.path}`);
      if (!sourceFile) {
        throw new Error(`TypeScript did not parse ${module.path}.`);
      }
      const fileLines = lineCount(module.source);
      if (fileLines > MAX_FILE_LINES) {
        fail('production-leaf-span', module.path, fileLines);
      }
      validateCallables(module.path, sourceFile);
    }
  } finally {
    api.close();
  }
};
