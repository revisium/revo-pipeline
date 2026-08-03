import { dirname, posix } from 'node:path';

import * as ts from 'typescript/unstable/ast';
import {
  ModifierFlags,
  SyntaxKind,
  type BindingName,
  type Node,
  type SourceFile,
  type Statement,
} from 'typescript/unstable/ast';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API } from 'typescript/unstable/sync';

export interface SourceModule {
  readonly path: string;
  readonly source: string;
}

export type ArchitectureRule =
  | 'architecture-one-export-per-leaf'
  | 'cross-layer-private-import'
  | 'explicit-barrel-exports'
  | 'forbidden-external-import'
  | 'forbidden-production-target'
  | 'internal-root-import'
  | 'layer-dependency'
  | 'one-export-per-leaf'
  | 'own-barrel-import'
  | 'relative-js-suffix'
  | 'root-public-api'
  | 'test-private-import'
  | 'type-only-barrel'
  | 'type-only-layer'
  | 'unknown-production-area';

interface ModuleReference {
  readonly specifier: string;
  readonly target?: string;
}

const LAYERS = ['spec', 'policy', 'errors', 'graph', 'definition', 'transition'] as const;
type Layer = (typeof LAYERS)[number];

const ALLOWED_DEPENDENCIES: Readonly<Record<Layer, readonly Layer[]>> = {
  spec: [],
  policy: [],
  errors: ['spec', 'policy'],
  graph: ['spec', 'policy', 'errors'],
  definition: ['spec', 'policy', 'errors', 'graph'],
  transition: ['spec', 'policy', 'errors', 'graph'],
};

interface RootExport {
  readonly name: string;
  readonly source: string;
  readonly typeOnly: boolean;
}

const rootExports = (
  source: string,
  typeOnly: boolean,
  names: readonly string[],
): readonly RootExport[] => names.map((name) => ({ name, source, typeOnly }));

const ROOT_EXPORTS: readonly RootExport[] = [
  ...rootExports('./definition/index.js', false, ['compilePipeline', 'definePipeline']),
  ...rootExports('./transition/index.js', false, [
    'decidePipeline',
    'decodeCompiledPipeline',
    'reducePipeline',
  ]),
  ...rootExports('./spec/index.js', true, [
    'ActivateDecision',
    'ActivationCause',
    'AllJoinPolicy',
    'AnyJoinPolicy',
    'BranchCase',
    'BranchDefault',
    'BranchName',
    'BranchNode',
    'BranchPredicate',
    'CandidateKey',
    'CandidateVerdict',
    'CompiledEdge',
    'CompiledEdgeIndexEntry',
    'CompiledEdgeRole',
    'CompiledForkBranch',
    'CompiledForkRegion',
    'CompiledNode',
    'CompiledNodeIndexEntry',
    'CompiledPipeline',
    'ConsensusNode',
    'ConsensusOutcome',
    'ConsensusPolicy',
    'ConsensusRoutes',
    'ExecutorRequirement',
    'FactDefinition',
    'FactKey',
    'FactType',
    'ForkBranch',
    'ForkNode',
    'GateResolution',
    'HumanGateNode',
    'HumanGateRoute',
    'JoinNode',
    'JoinOutcome',
    'JoinPolicy',
    'JoinRoutes',
    'JsonScalar',
    'JsonValue',
    'NodeFact',
    'NodeKey',
    'NoopDecision',
    'PipelineDefinition',
    'PipelineExecutionTemplate',
    'PipelineFacts',
    'PipelineNode',
    'PipelineCandidateVerdictRecord',
    'PipelineCommand',
    'PipelineCommandApplication',
    'PipelineEffect',
    'PipelineEffectBatch',
    'PipelineForkRelation',
    'PipelineGateResolutionRecord',
    'PipelineNodeOccurrence',
    'PipelineOccurrenceKey',
    'PipelineReductionStatus',
    'PipelineRetirement',
    'PipelineSnapshot',
    'PipelineSnapshotNode',
    'PipelineTerminal',
    'PipelineValueRecord',
    'PipelineValueSource',
    'PipelineWait',
    'PipelineValueFact',
    'QuorumConsensusPolicy',
    'ResolutionName',
    'ScriptIdentity',
    'ScriptNode',
    'SelectDecision',
    'TaskNode',
    'TaskOutcome',
    'TaskRoutes',
    'TerminalBindingTemplate',
    'TerminalDecision',
    'TerminalNode',
    'ThresholdConsensusPolicy',
    'ThresholdJoinPolicy',
    'UnanimousConsensusPolicy',
    'WaitDecision',
    'WaitReason',
  ]),
  ...rootExports('./errors/index.js', true, [
    'CompiledPipelineDecoding',
    'DecodeFault',
    'DecodeFaultCode',
    'DecisionFault',
    'DecisionFaultCode',
    'DefinitionFault',
    'DefinitionFaultCode',
    'PipelineCompilation',
    'PipelineDecision',
    'PipelineReduction',
    'PipelineReductionFault',
    'PipelineReductionFaultCode',
    'RejectDecision',
  ]),
];

const rootExportNames = (source: string, typeOnly: boolean): readonly string[] =>
  ROOT_EXPORTS.filter(
    (rootExport) => rootExport.source === source && rootExport.typeOnly === typeOnly,
  ).map(({ name }) => name);

const ROOT_SOURCE = [
  `export { ${rootExportNames('./definition/index.js', false).join(', ')} } from './definition/index.js';`,
  `export { ${rootExportNames('./transition/index.js', false).join(', ')} } from './transition/index.js';`,
  `export type { ${rootExportNames('./spec/index.js', true).join(', ')} } from './spec/index.js';`,
  `export type { ${rootExportNames('./errors/index.js', true).join(', ')} } from './errors/index.js';`,
].join('\n');

const rootTokens = (source: string): string => source.replaceAll(/\s/gu, '').replaceAll(',}', '}');

const fail = (rule: ArchitectureRule, path: string): never => {
  throw new Error(`[${rule}] ${path}`);
};

const normalized = (path: string): string => posix.normalize(path.replaceAll('\\', '/'));
const isRoot = (path: string): boolean => path === 'src/index.ts';
const isBarrel = (path: string): boolean =>
  /^src\/(?:spec|policy|errors|definition|graph|transition)\/index\.ts$/.test(path);
const isProductionLeaf = (path: string): boolean =>
  path.startsWith('src/') && path.endsWith('.ts') && !isRoot(path) && !isBarrel(path);
const layerOf = (path: string): Layer | undefined => {
  const candidate = /^src\/([^/]+)(?:\/|$)/.exec(path)?.[1];
  return LAYERS.find((layer) => layer === candidate);
};

const validateProductionArea = (path: string): void => {
  if (path.startsWith('src/') && path.endsWith('.ts') && !isRoot(path) && !layerOf(path)) {
    fail('unknown-production-area', path);
  }
};

const hasExportModifier = (flags: ModifierFlags): boolean => (flags & ModifierFlags.Export) !== 0;

const bindingNameCount = (name: BindingName): number => {
  if (ts.isIdentifier(name)) {
    return 1;
  }
  return name.elements.reduce(
    (count, element) =>
      count +
      (ts.isOmittedExpression(element) || element.name === undefined
        ? 0
        : bindingNameCount(element.name)),
    0,
  );
};

const exportedEntityCount = (statements: readonly Statement[]): number =>
  statements.reduce((count, statement) => {
    if (ts.isExportDeclaration(statement)) {
      return (
        count +
        (statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.length
          : 2)
      );
    }
    if (ts.isExportAssignment(statement) || ts.isNamespaceExportDeclaration(statement)) {
      return count + 1;
    }
    if (ts.isVariableStatement(statement)) {
      if (!hasExportModifier(statement.modifierFlags)) {
        return count;
      }
      return (
        count +
        statement.declarationList.declarations.reduce(
          (names, declaration) => names + bindingNameCount(declaration.name),
          0,
        )
      );
    }
    if (
      (ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)) &&
      hasExportModifier(statement.modifierFlags)
    ) {
      return count + 1;
    }
    return count;
  }, 0);

const moduleSpecifierText = (node: Node | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

const validateRoot = (path: string, sourceFile: SourceFile): void => {
  if (!isRoot(path)) {
    return;
  }
  if (rootTokens(sourceFile.text) !== rootTokens(ROOT_SOURCE)) {
    fail('root-public-api', path);
  }
};

const validateExplicitBarrel = (path: string, sourceFile: SourceFile): void => {
  if (!isBarrel(path)) {
    return;
  }
  const layer = layerOf(path);
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause) ||
      moduleSpecifierText(statement.moduleSpecifier) === undefined
    ) {
      fail('explicit-barrel-exports', path);
    }
    if (
      (layer === 'spec' || layer === 'errors') &&
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly
    ) {
      fail('type-only-barrel', path);
    }
  }
};

const validateTypeOnlyLayer = (path: string, sourceFile: SourceFile): void => {
  const layer = layerOf(path);
  if ((layer !== 'spec' && layer !== 'errors') || isBarrel(path)) {
    return;
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.phaseModifier !== SyntaxKind.TypeKeyword) {
        fail('type-only-layer', path);
      }
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      if (!statement.isTypeOnly) {
        fail('type-only-layer', path);
      }
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.isTypeOnly) {
      continue;
    }
    fail('type-only-layer', path);
  }
};

const referenceFromSpecifier = (
  path: string,
  node: Node | undefined,
): ModuleReference | undefined => {
  const specifier = moduleSpecifierText(node);
  if (specifier === undefined) {
    return undefined;
  }
  if (!specifier.startsWith('.')) {
    return { specifier };
  }
  if (!specifier.endsWith('.js')) {
    fail('relative-js-suffix', path);
  }
  return {
    specifier,
    target: normalized(posix.join(dirname(path), specifier.replace(/\.js$/, '.ts'))),
  };
};

const moduleReferences = (path: string, sourceFile: SourceFile): readonly ModuleReference[] => {
  const references: ModuleReference[] = [];
  const append = (node: Node | undefined): void => {
    const reference = referenceFromSpecifier(path, node);
    if (reference) {
      references.push(reference);
    }
  };
  const visit = (node: Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      append(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      append(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (moduleSpecifierText(argument) === undefined) {
        fail('relative-js-suffix', path);
      }
      append(argument);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      append(node.argument.literal);
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return references;
};

const validateReferences = (path: string, references: readonly ModuleReference[]): void => {
  const sourceLayer = layerOf(path);
  for (const reference of references) {
    if (!reference.target) {
      if (path.startsWith('src/')) {
        fail('forbidden-external-import', path);
      }
      continue;
    }

    if (path.startsWith('src/') && !reference.target.startsWith('src/')) {
      fail('forbidden-production-target', path);
    }
    if (sourceLayer && isRoot(reference.target)) {
      fail('internal-root-import', path);
    }

    const targetLayer = layerOf(reference.target);
    if (
      path.startsWith('src/') &&
      reference.target.startsWith('src/') &&
      !isRoot(reference.target) &&
      !targetLayer
    ) {
      fail('unknown-production-area', path);
    }
    if (path.startsWith('test/') && targetLayer && !isBarrel(reference.target)) {
      fail('test-private-import', path);
    }
    if (!sourceLayer || !targetLayer) {
      continue;
    }

    if (sourceLayer === targetLayer) {
      if (reference.target === `src/${sourceLayer}/index.ts`) {
        fail('own-barrel-import', path);
      }
      continue;
    }

    if (!isBarrel(reference.target)) {
      fail('cross-layer-private-import', path);
    }
    if (!ALLOWED_DEPENDENCIES[sourceLayer].includes(targetLayer)) {
      fail('layer-dependency', path);
    }
  }
};

const validateSourceFile = (path: string, sourceFile: SourceFile): void => {
  if (
    path === 'scripts/architecture/validate-graph-kernel-flow.ts' &&
    exportedEntityCount(sourceFile.statements) !== 1
  ) {
    fail('architecture-one-export-per-leaf', path);
  }
  validateProductionArea(path);
  validateRoot(path, sourceFile);
  validateExplicitBarrel(path, sourceFile);
  validateTypeOnlyLayer(path, sourceFile);
  if (isProductionLeaf(path) && exportedEntityCount(sourceFile.statements) !== 1) {
    fail('one-export-per-leaf', path);
  }
  validateReferences(path, moduleReferences(path, sourceFile));
};

export const validateModuleStructure = (modules: readonly SourceModule[]): void => {
  if (modules.length === 0) {
    return;
  }

  const virtualRoot = '/module-structure';
  const configPath = `${virtualRoot}/tsconfig.json`;
  const normalizedModules = modules.map((module) => ({ ...module, path: normalized(module.path) }));
  const files: Record<string, string> = {
    [configPath]: JSON.stringify({ files: normalizedModules.map((module) => module.path) }),
  };
  for (const module of normalizedModules) {
    files[`${virtualRoot}/${module.path}`] = module.source;
  }

  const api = new API({ cwd: virtualRoot, fs: createVirtualFileSystem(files) });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [configPath] });
    const project = snapshot.getProjects()[0];
    if (!project) {
      throw new Error('TypeScript did not create the module-structure project.');
    }
    for (const module of normalizedModules) {
      const sourceFile = project.program.getSourceFile(`${virtualRoot}/${module.path}`);
      if (!sourceFile) {
        throw new Error(`TypeScript did not parse ${module.path}.`);
      }
      validateSourceFile(module.path, sourceFile);
    }
  } finally {
    api.close();
  }
};
