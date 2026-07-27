import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';

import * as ts from 'typescript/unstable/ast';
import {
  NodeFlags,
  SyntaxKind,
  type CallExpression,
  type FunctionLikeDeclaration,
  type Identifier,
  type IfStatement,
  type Node,
  type SourceFile,
  type VariableDeclaration,
} from 'typescript/unstable/ast';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API, SymbolFlags, type Checker } from 'typescript/unstable/sync';

type GraphKernelRule =
  | 'GRAPH_KERNEL_ADAPTER_EXPOSURE'
  | 'GRAPH_KERNEL_ANALYSIS_UNPROVEN'
  | 'GRAPH_KERNEL_BUILD_REPEAT'
  | 'GRAPH_KERNEL_BUILD_SITE'
  | 'GRAPH_KERNEL_CACHE'
  | 'GRAPH_KERNEL_IDENTITY_FLOW'
  | 'GRAPH_KERNEL_INPUT_PROVENANCE'
  | 'GRAPH_KERNEL_REBUILD'
  | 'GRAPH_KERNEL_TRUST_DOMINANCE';

interface ArchitectureViolation {
  readonly code: GraphKernelRule;
  readonly path: string;
  readonly line: number;
}

interface ParsedModule {
  readonly path: string;
  readonly sourceFile: SourceFile;
}

interface BuilderCall {
  readonly module: ParsedModule;
  readonly call: CallExpression;
  readonly declaration: VariableDeclaration | undefined;
  readonly owner: FunctionLikeDeclaration | undefined;
}

const TRACKED_NAMES = new Set([
  'buildGraphKernel',
  'decidePipeline',
  'evaluationIndex',
  'GraphKernel',
  'ValidatedCompiledPipeline',
  'assembleCompiledPipeline',
  'classifyForkRegions',
  'normalizePipelineNode',
  'preflightForkRegions',
  'projectPipelineEdges',
  'validateDefinition',
  'validateDefinitionGraph',
  'compareSerializedGraph',
  'deriveExpectedCompiledSemantics',
  'precheckCompiledBounds',
  'snapshotCompiledInput',
  'validateCompiledInternally',
  'validateCompiledMembers',
  'validateCompiledPipeline',
  'verifySerializedIndexes',
  'verifySerializedTopology',
]);

const ALLOWED_BUILDERS = new Map([
  ['src/definition/compilation/validate-definition-graph.ts', 'validateDefinitionGraph'],
  ['src/transition/compiled/validate-compiled-internally.ts', 'validateCompiledInternally'],
]);

const REQUIRED_PATHS = [
  'src/definition/compilation/assemble-compiled-pipeline.ts',
  'src/definition/compilation/classify-fork-regions.ts',
  'src/definition/compilation/normalize-pipeline-node.ts',
  'src/definition/compilation/preflight-fork-regions.ts',
  'src/definition/compilation/project-pipeline-edges.ts',
  'src/definition/compilation/validate-definition-graph.ts',
  'src/definition/compile-pipeline.ts',
  'src/definition/contracts/compiler-semantic-graph.ts',
  'src/graph/build-graph-kernel.ts',
  'src/graph/graph-kernel.ts',
  'src/graph/index.ts',
  'src/transition/compiled/compare-serialized-graph.ts',
  'src/transition/compiled/derive-expected-compiled-semantics.ts',
  'src/transition/compiled/expected-compiled-semantics.ts',
  'src/transition/compiled/hostile-compiled-validation.ts',
  'src/transition/compiled/precheck-compiled-bounds.ts',
  'src/transition/compiled/snapshot-compiled-input.ts',
  'src/transition/compiled/validate-compiled-branch.ts',
  'src/transition/compiled/validate-compiled-internally.ts',
  'src/transition/compiled/validate-compiled-members.ts',
  'src/transition/compiled/validate-compiled-node.ts',
  'src/transition/compiled/verify-serialized-indexes.ts',
  'src/transition/compiled/verify-serialized-topology.ts',
  'src/transition/decide-pipeline.ts',
  'src/transition/validate-compiled-pipeline.ts',
] as const;

const normalizedPath = (path: string): string => path.replaceAll('\\', '/');

const collectSources = (rootDirectory: string): readonly { path: string; source: string }[] => {
  const sourceRoot = join(rootDirectory, 'src');
  const visit = (directory: string): readonly { path: string; source: string }[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return visit(path);
      }
      return entry.name.endsWith('.ts')
        ? [
            {
              path: normalizedPath(relative(rootDirectory, path)),
              source: readFileSync(path, 'utf8'),
            },
          ]
        : [];
    });
  return [...visit(sourceRoot)].sort((left, right) => left.path.localeCompare(right.path));
};

const nameOf = (node: Node | undefined): string | undefined =>
  node && ts.isIdentifier(node) ? node.text : undefined;

const propertyName = (node: Node): string | undefined => {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    (ts.isStringLiteral(node.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
};

const functionName = (node: FunctionLikeDeclaration): string | undefined => {
  if ('name' in node && node.name && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  const parent = node.parent;
  return parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : undefined;
};

const isFunctionLikeDeclaration = (node: Node): node is FunctionLikeDeclaration =>
  ts.isArrowFunction(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

const containingFunction = (node: Node): FunctionLikeDeclaration | undefined => {
  let current = node.parent;
  while (current) {
    if (isFunctionLikeDeclaration(current)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
};

const insideRepeatableConstruct = (
  node: Node,
  owner: FunctionLikeDeclaration | undefined,
): boolean => {
  let current = node.parent;
  while (current && current !== owner) {
    if (
      ts.isForStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current)
    ) {
      return true;
    }
    if (isFunctionLikeDeclaration(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

const declarationOfCall = (call: CallExpression): VariableDeclaration | undefined => {
  const parent = call.parent;
  return parent && ts.isVariableDeclaration(parent) && parent.initializer === call
    ? parent
    : undefined;
};

const isConstDeclaration = (declaration: VariableDeclaration): boolean =>
  ts.isVariableDeclarationList(declaration.parent) &&
  (declaration.parent.flags & NodeFlags.Const) !== 0;

const topLevelStatement = (owner: FunctionLikeDeclaration, node: Node): Node | undefined => {
  if (!owner.body || !ts.isBlock(owner.body)) {
    return undefined;
  }
  let current = node;
  while (current.parent && current.parent !== owner.body) {
    current = current.parent;
  }
  return current.parent === owner.body ? current : undefined;
};

const isDirectTopLevelCall = (owner: FunctionLikeDeclaration, call: CallExpression): boolean => {
  const statement = topLevelStatement(owner, call);
  if (statement === undefined) {
    return false;
  }
  if (ts.isExpressionStatement(statement)) {
    return statement.expression === call;
  }
  if (ts.isReturnStatement(statement)) {
    return statement.expression === call;
  }
  if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
    return false;
  }
  const declaration = statement.declarationList.declarations[0];
  return (
    declaration !== undefined && isConstDeclaration(declaration) && declaration.initializer === call
  );
};

const isTerminatingGuard = (statement: Node | undefined): statement is IfStatement => {
  if (!statement || !ts.isIfStatement(statement) || !ts.isBlock(statement.thenStatement)) {
    return false;
  }
  const terminatingStatement = statement.thenStatement.statements[0];
  return (
    statement.elseStatement === undefined &&
    statement.thenStatement.statements.length === 1 &&
    terminatingStatement !== undefined &&
    (ts.isReturnStatement(terminatingStatement) || ts.isThrowStatement(terminatingStatement))
  );
};

const propertyPath = (node: Node): readonly string[] | undefined => {
  if (ts.isIdentifier(node)) {
    return [node.text];
  }
  if (!ts.isPropertyAccessExpression(node)) {
    return undefined;
  }
  const parent = propertyPath(node.expression);
  return parent ? [...parent, node.name.text] : undefined;
};

const callNamed = (node: Node, name: string): node is CallExpression =>
  ts.isCallExpression(node) &&
  ((ts.isIdentifier(node.expression) && node.expression.text === name) ||
    (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name));

const descendants = (root: Node): readonly Node[] => {
  const nodes: Node[] = [];
  const visit = (node: Node): void => {
    nodes.push(node);
    node.forEachChild(visit);
  };
  visit(root);
  return nodes;
};

const findFunction = (
  modules: readonly ParsedModule[],
  path: string,
  name: string,
): FunctionLikeDeclaration | undefined => {
  const sourceFile = modules.find((module) => module.path === path)?.sourceFile;
  return sourceFile
    ? descendants(sourceFile).find(
        (node): node is FunctionLikeDeclaration =>
          isFunctionLikeDeclaration(node) && functionName(node) === name,
      )
    : undefined;
};

const identifierReferences = (root: Node, name: string): readonly Identifier[] =>
  descendants(root).filter(
    (node): node is Identifier => ts.isIdentifier(node) && node.text === name,
  );

const initializerText = (declaration: VariableDeclaration | undefined): string =>
  declaration?.initializer?.getText() ?? '';

const directCalls = (root: Node, name: string): readonly CallExpression[] =>
  descendants(root).filter((node): node is CallExpression => callNamed(node, name));

const functionIdentifier = (owner: FunctionLikeDeclaration): Identifier | undefined => {
  if ('name' in owner && owner.name && ts.isIdentifier(owner.name)) {
    return owner.name;
  }
  const parent = owner.parent;
  return parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name
    : undefined;
};

const resolvedSymbolId = (checker: Checker, identifier: Identifier): number | undefined => {
  const symbol = checker.getResolvedSymbol(identifier);
  if (!symbol) {
    return undefined;
  }
  const resolved =
    (symbol.flags & SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol);
  return checker.isUnknownSymbol(resolved) ? undefined : resolved.getExportSymbol().id;
};

const resolvedCalls = (
  checker: Checker,
  owner: FunctionLikeDeclaration,
  target: FunctionLikeDeclaration,
): readonly CallExpression[] => {
  const targetIdentifier = functionIdentifier(target);
  const targetSymbol = targetIdentifier ? resolvedSymbolId(checker, targetIdentifier) : undefined;
  if (targetSymbol === undefined) {
    return [];
  }
  return descendants(owner).filter(
    (node): node is CallExpression =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      resolvedSymbolId(checker, node.expression) === targetSymbol,
  );
};

const typeNames = (node: Node): readonly string[] =>
  descendants(node)
    .filter((candidate): candidate is Identifier => ts.isIdentifier(candidate))
    .map((identifier) => identifier.text);

const objectProperty = (object: Node | undefined, name: string): Node | undefined => {
  if (!object || !ts.isObjectLiteralExpression(object)) {
    return undefined;
  }
  const property = object.properties.find(
    (candidate) =>
      (ts.isPropertyAssignment(candidate) || ts.isShorthandPropertyAssignment(candidate)) &&
      nameOf(candidate.name) === name,
  );
  if (!property) {
    return undefined;
  }
  if (ts.isPropertyAssignment(property)) {
    return property.initializer;
  }
  return ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
};

const exactPropertyPath = (node: Node | undefined, path: readonly string[]): boolean =>
  node !== undefined && JSON.stringify(propertyPath(node)) === JSON.stringify(path);

const stringValue = (node: Node | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

const switchClause = (owner: FunctionLikeDeclaration, value: string): ts.CaseClause | undefined => {
  const clauses = descendants(owner).filter(
    (node): node is ts.CaseClause =>
      ts.isCaseClause(node) &&
      containingFunction(node) === owner &&
      ts.isSwitchStatement(node.parent.parent) &&
      topLevelStatement(owner, node.parent.parent) === node.parent.parent &&
      exactPropertyPath(node.parent.parent.expression, ['node', 'kind']) &&
      stringValue(node.expression) === value,
  );
  return clauses.length === 1 ? clauses[0] : undefined;
};

const directClauseReturn = (clause: ts.CaseClause | undefined): ts.ReturnStatement | undefined => {
  if (!clause || clause.statements.length !== 1) {
    return undefined;
  }
  const statement = clause.statements[0];
  return statement && ts.isReturnStatement(statement) ? statement : undefined;
};

const isIdentifierNamed = (node: Node | undefined, name: string): boolean =>
  node !== undefined && ts.isIdentifier(node) && node.text === name;

const hasExactObjectProperties = (
  node: Node | undefined,
  expectedNames: readonly string[],
): node is ts.ObjectLiteralExpression => {
  if (
    !node ||
    !ts.isObjectLiteralExpression(node) ||
    node.properties.length !== expectedNames.length
  ) {
    return false;
  }
  const names = node.properties.map((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      return undefined;
    }
    return nameOf(property.name);
  });
  return names.every((name, index) => name === expectedNames[index]);
};

const isExactCall = (
  node: Node | undefined,
  name: string,
  argumentsMatch: readonly ((argument: Node | undefined) => boolean)[],
): node is CallExpression =>
  node !== undefined &&
  ts.isCallExpression(node) &&
  callNamed(node, name) &&
  node.arguments.length === argumentsMatch.length &&
  argumentsMatch.every((matches, index) => matches(node.arguments[index]));

const localConst = (
  owner: FunctionLikeDeclaration,
  name: string,
): VariableDeclaration | undefined =>
  descendants(owner).find(
    (node): node is VariableDeclaration =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      isConstDeclaration(node) &&
      topLevelStatement(owner, node) !== undefined,
  );

const validatesHumanGateNormalization = (owner: FunctionLikeDeclaration): boolean => {
  const returned = directClauseReturn(switchClause(owner, 'humanGate'))?.expression;
  if (!hasExactObjectProperties(returned, ['kind', 'key', 'subject', 'resolutions'])) {
    return false;
  }
  const subject = objectProperty(returned, 'subject');
  return (
    subject !== undefined &&
    ts.isCallExpression(subject) &&
    ts.isPropertyAccessExpression(subject.expression) &&
    exactPropertyPath(subject.expression.expression, ['node', 'subject']) &&
    subject.expression.name.text === 'normalize' &&
    subject.arguments.length === 1 &&
    stringValue(subject.arguments[0]) === 'NFC'
  );
};

const validatesHumanGateProjection = (owner: FunctionLikeDeclaration): boolean => {
  const returned = directClauseReturn(switchClause(owner, 'humanGate'))?.expression;
  if (
    !returned ||
    !ts.isCallExpression(returned) ||
    !ts.isPropertyAccessExpression(returned.expression) ||
    !exactPropertyPath(returned.expression.expression, ['node', 'resolutions']) ||
    returned.expression.name.text !== 'map' ||
    returned.arguments.length !== 1
  ) {
    return false;
  }
  const mapper = returned.arguments[0];
  const mapperParameter = mapper && ts.isArrowFunction(mapper) ? mapper.parameters[0] : undefined;
  if (
    !mapper ||
    !ts.isArrowFunction(mapper) ||
    mapper.parameters.length !== 1 ||
    !mapperParameter ||
    !ts.isIdentifier(mapperParameter.name) ||
    !ts.isCallExpression(mapper.body) ||
    !callNamed(mapper.body, 'edge') ||
    mapper.body.arguments.length !== 2
  ) {
    return false;
  }
  const parameter = mapperParameter.name.text;
  return (
    exactPropertyPath(mapper.body.arguments[0], [parameter, 'resolution']) &&
    exactPropertyPath(mapper.body.arguments[1], [parameter, 'to'])
  );
};

const isUndefinedComparison = (node: Node | undefined, path: readonly string[]): boolean =>
  node !== undefined &&
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === SyntaxKind.ExclamationEqualsEqualsToken &&
  exactPropertyPath(node.left, path) &&
  isIdentifierNamed(node.right, 'undefined');

const validatesPreflightQuery = (owner: FunctionLikeDeclaration): boolean => {
  const declarations = descendants(owner).filter(
    (node): node is VariableDeclaration =>
      ts.isVariableDeclaration(node) &&
      containingFunction(node) === owner &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'queryIsKnown' &&
      isConstDeclaration(node),
  );
  const declaration = declarations.length === 1 ? declarations[0] : undefined;
  const declarationStatement =
    declaration &&
    ts.isVariableDeclarationList(declaration.parent) &&
    ts.isVariableStatement(declaration.parent.parent)
      ? declaration.parent.parent
      : undefined;
  const loopBody = declarationStatement?.parent;
  const loop = loopBody?.parent;
  const initializer =
    loopBody &&
    ts.isBlock(loopBody) &&
    loop &&
    ts.isForOfStatement(loop) &&
    loop.statement === loopBody &&
    topLevelStatement(owner, loop) === loop &&
    declarationStatement &&
    loopBody.statements.includes(declarationStatement)
      ? declaration?.initializer
      : undefined;
  if (
    !initializer ||
    !ts.isBinaryExpression(initializer) ||
    initializer.operatorToken.kind !== SyntaxKind.AmpersandAmpersandToken ||
    !isUndefinedComparison(initializer.left, ['barrierNodeOffset']) ||
    !ts.isCallExpression(initializer.right) ||
    !ts.isPropertyAccessExpression(initializer.right.expression) ||
    !isIdentifierNamed(initializer.right.expression.expression, 'queryBranches') ||
    initializer.right.expression.name.text !== 'every' ||
    initializer.right.arguments.length !== 1
  ) {
    return false;
  }
  const predicate = initializer.right.arguments[0];
  const predicateParameter =
    predicate && ts.isArrowFunction(predicate) ? predicate.parameters[0] : undefined;
  if (
    !predicate ||
    !ts.isArrowFunction(predicate) ||
    predicate.parameters.length !== 1 ||
    !predicateParameter ||
    !ts.isIdentifier(predicateParameter.name) ||
    !ts.isBinaryExpression(predicate.body) ||
    predicate.body.operatorToken.kind !== SyntaxKind.AmpersandAmpersandToken
  ) {
    return false;
  }
  const parameter = predicateParameter.name.text;
  const queryIsExact =
    isUndefinedComparison(predicate.body.left, [parameter, 'entryNodeOffset']) &&
    isUndefinedComparison(predicate.body.right, [parameter, 'exitNodeOffset']);
  const returns =
    owner.body && ts.isBlock(owner.body)
      ? owner.body.statements.filter((statement): statement is ts.ReturnStatement =>
          ts.isReturnStatement(statement),
        )
      : [];
  const returned = returns.length === 1 ? returns[0]?.expression : undefined;
  return (
    queryIsExact &&
    returned !== undefined &&
    ts.isObjectLiteralExpression(returned) &&
    returned.properties.length === 2 &&
    isIdentifierNamed(objectProperty(returned, 'forks'), 'forks') &&
    isIdentifierNamed(objectProperty(returned, 'queries'), 'queries')
  );
};

const assignmentMatches = (
  statement: Node | undefined,
  left: readonly string[],
  right: readonly string[],
): boolean =>
  statement !== undefined &&
  ts.isExpressionStatement(statement) &&
  ts.isBinaryExpression(statement.expression) &&
  statement.expression.operatorToken.kind === SyntaxKind.EqualsToken &&
  exactPropertyPath(statement.expression.left, left) &&
  exactPropertyPath(statement.expression.right, right);

const validatesReadinessAssignments = (owner: FunctionLikeDeclaration): boolean => {
  const loops = descendants(owner).filter(
    (node): node is ts.ForOfStatement =>
      ts.isForOfStatement(node) &&
      containingFunction(node) === owner &&
      topLevelStatement(owner, node) === node &&
      isIdentifierNamed(node.expression, 'exitEdges'),
  );
  const body = loops.length === 1 ? loops[0]?.statement : undefined;
  if (!body || !ts.isBlock(body) || body.statements.length !== 3) {
    return false;
  }
  const roleAssignment = body.statements[0];
  const roleIsReadiness =
    roleAssignment !== undefined &&
    ts.isExpressionStatement(roleAssignment) &&
    ts.isBinaryExpression(roleAssignment.expression) &&
    roleAssignment.expression.operatorToken.kind === SyntaxKind.EqualsToken &&
    exactPropertyPath(roleAssignment.expression.left, ['edge', 'role']) &&
    stringValue(roleAssignment.expression.right) === 'readiness';
  return (
    roleIsReadiness &&
    assignmentMatches(body.statements[1], ['edge', 'fork'], ['fork', 'fork', 'key']) &&
    assignmentMatches(body.statements[2], ['edge', 'branch'], ['branch', 'branch', 'name'])
  );
};

const validatesAssemblyPromotion = (owner: FunctionLikeDeclaration): boolean => {
  const returns =
    owner.body && ts.isBlock(owner.body)
      ? owner.body.statements.filter((statement): statement is ts.ReturnStatement =>
          ts.isReturnStatement(statement),
        )
      : [];
  const returned = returns.length === 1 ? returns[0]?.expression : undefined;
  if (!hasExactObjectProperties(returned, ['ok', 'pipeline'])) {
    return false;
  }
  const ok = objectProperty(returned, 'ok');
  const pipeline = objectProperty(returned, 'pipeline');
  if (
    ok?.kind !== SyntaxKind.TrueKeyword ||
    !pipeline ||
    !isExactCall(pipeline, 'deepFreeze', [
      (argument) => argument !== undefined && ts.isObjectLiteralExpression(argument),
    ])
  ) {
    return false;
  }
  const snapshot = pipeline.arguments[0];
  if (!snapshot || !ts.isObjectLiteralExpression(snapshot)) {
    return false;
  }
  const spreads = snapshot.properties.filter(ts.isSpreadAssignment);
  return (
    exactPropertyPath(objectProperty(snapshot, 'edges'), ['graph', 'edges']) &&
    spreads.length === 1 &&
    isExactCall(spreads[0]?.expression, 'buildIndexes', [
      (argument) => isIdentifierNamed(argument, 'nodes'),
      (argument) => isIdentifierNamed(argument, 'graph'),
    ])
  );
};

const validatesAssemblyIndexes = (owner: FunctionLikeDeclaration): boolean => {
  if (!owner.body || !ts.isParenthesizedExpression(owner.body)) {
    return false;
  }
  const returned = owner.body.expression;
  const outgoingIndex = objectProperty(returned, 'outgoingIndex');
  const incomingIndex = objectProperty(returned, 'incomingIndex');
  const exactIndexMap = (node: Node | undefined, direction: 'incoming' | 'outgoing'): boolean => {
    if (
      !node ||
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      !isIdentifierNamed(node.expression.expression, 'nodes') ||
      node.expression.name.text !== 'map' ||
      node.arguments.length !== 1
    ) {
      return false;
    }
    const mapper = node.arguments[0];
    const nodeParameter = mapper && ts.isArrowFunction(mapper) ? mapper.parameters[0] : undefined;
    const offsetParameter = mapper && ts.isArrowFunction(mapper) ? mapper.parameters[1] : undefined;
    if (
      !mapper ||
      !ts.isArrowFunction(mapper) ||
      mapper.parameters.length !== 2 ||
      !nodeParameter ||
      !ts.isIdentifier(nodeParameter.name) ||
      !offsetParameter ||
      !ts.isIdentifier(offsetParameter.name) ||
      !ts.isParenthesizedExpression(mapper.body) ||
      !ts.isObjectLiteralExpression(mapper.body.expression)
    ) {
      return false;
    }
    const nodeName = nodeParameter.name.text;
    const offsetName = offsetParameter.name.text;
    const edges = objectProperty(mapper.body.expression, 'edges');
    return (
      exactPropertyPath(objectProperty(mapper.body.expression, 'key'), [nodeName, 'key']) &&
      edges !== undefined &&
      ts.isBinaryExpression(edges) &&
      edges.operatorToken.kind === SyntaxKind.QuestionQuestionToken &&
      ts.isElementAccessExpression(edges.left) &&
      exactPropertyPath(edges.left.expression, ['graph', 'kernel', `${direction}EdgeOffsets`]) &&
      isIdentifierNamed(edges.left.argumentExpression, offsetName) &&
      ts.isArrayLiteralExpression(edges.right) &&
      edges.right.elements.length === 0
    );
  };
  return (
    returned !== undefined &&
    ts.isObjectLiteralExpression(returned) &&
    exactIndexMap(outgoingIndex, 'outgoing') &&
    exactIndexMap(incomingIndex, 'incoming')
  );
};

const add = (
  violations: ArchitectureViolation[],
  code: GraphKernelRule,
  module: ParsedModule | undefined,
  node?: Node,
): void => {
  const path = module?.path ?? 'src';
  const line =
    module && node ? module.sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1 : 1;
  if (
    !violations.some((entry) => entry.code === code && entry.path === path && entry.line === line)
  ) {
    violations.push({ code, path, line });
  }
};

const compactSource = (value: string): string => value.replaceAll(/\s+/gu, '');

const COMPILER_SEMANTIC_CONTRACTS = [
  {
    path: 'src/definition/compilation/normalize-pipeline-node.ts',
    name: 'normalizeCase',
    required: [
      "entry.when.op==='equals'?{op:'equals',value:normalizeJsonScalar(entry.when.value)}",
      "op:'oneOf',values:entry.when.values.map(normalizeJsonScalar).sort(scalarComparator)",
    ],
  },
  {
    path: 'src/definition/compilation/normalize-pipeline-node.ts',
    name: 'normalizePipelineNode',
    required: [
      "case'task':return{kind:'task',key:node.key,outcomes:{...node.outcomes}}",
      'fact:node.fact,cases:node.cases.map(normalizeCase).sort((left,right)=>compareUnicodeCodePoints(left.name,right.name)||compareUnicodeCodePoints(left.to,right.to)',
      'default:node.default?{...node.default}:null',
      'join:node.join,branches:node.branches.map((branch)=>({...branch})).sort((left,right)=>compareUnicodeCodePoints(left.name,right.name)||compareUnicodeCodePoints(left.entry,right.entry)',
      'candidates:[...node.candidates].sort(compareUnicodeCodePoints),policy:{...node.policy},outcomes:{...node.outcomes}',
      'resolutions:node.resolutions.map((resolution)=>({...resolution})).sort((left,right)=>compareUnicodeCodePoints(left.resolution,right.resolution)||compareUnicodeCodePoints(left.to,right.to',
      "case'terminal':return{kind:'terminal',key:node.key,outcome:node.outcome.normalize('NFC')}",
    ],
  },
  {
    path: 'src/definition/compilation/project-pipeline-edges.ts',
    name: 'edgesForNode',
    required: [
      "from:node.key,outcome,to,role:'activation',fork:null,branch:null",
      'Object.entries(node.outcomes).map(([outcome,to])=>edge(outcome,to))',
      'node.cases.map((entry)=>edge(entry.name,entry.to))',
      'node.default?[edge(node.default.name,node.default.to)]:[]',
      "...edge('forked',branch.entry),fork:node.key,branch:branch.name",
      "{...edge('forked',node.join),fork:node.key}",
      "case'terminal':return[]",
    ],
  },
  {
    path: 'src/definition/compilation/project-pipeline-edges.ts',
    name: 'edgeComparator',
    required: [
      "compareUnicodeCodePoints(left.from,right.from)||compareUnicodeCodePoints(left.outcome,right.outcome)||compareUnicodeCodePoints(left.to,right.to)||compareUnicodeCodePoints(left.role,right.role)||compareUnicodeCodePoints(left.fork??'',right.fork??'')||compareUnicodeCodePoints(left.branch??'',right.branch??'')",
    ],
  },
  {
    path: 'src/definition/compilation/project-pipeline-edges.ts',
    name: 'projectPipelineEdges',
    required: ['edges:nodes.flatMap(edgesForNode).sort(edgeComparator)'],
  },
  {
    path: 'src/definition/compilation/preflight-fork-regions.ts',
    name: 'preflightForkRegions',
    required: [
      'constnodeByKey=newMap(nodes.map((node)=>[node.key,node]))',
      'constnodeOffsets=newMap(nodeKeys.map((key,offset)=>[key,offset]))',
      'constbarrierNodeOffset=nodeOffsets.get(join.key)',
      'entryNodeOffset:nodeOffsets.get(branch.entry),exitNodeOffset:nodeOffsets.get(branch.exit)',
      'constqueryIndex=queryIsKnown?queries.length:undefined',
      'if(queryIsKnown){queries.push({barrierNodeOffset,branches:queryBranches.map((branch)=>({entryNodeOffset:branch.entryNodeOffset!,exitNodeOffset:branch.exitNodeOffset!',
    ],
  },
  {
    path: 'src/definition/compilation/validate-definition-graph.ts',
    name: 'validateDefinitionGraph',
    required: [
      'validateReferences(entry,nodes,projectedEdges,sourceIndexes,faults)',
      'constedges:MutableCompiledEdge[]=projectedEdges.map((edge)=>({...edge}))',
      'constnodeKeys=nodes.map((node)=>node.key)',
      'constknownKeys=newSet(nodeKeys)',
      'knownKeys.has(edge.from)&&knownKeys.has(edge.to)',
      'edge:Object.freeze({from:edge.from,outcome:edge.outcome,to:edge.to}),semanticOffset',
      'constinducedEdges=Object.freeze(induced.map(({edge})=>edge))',
      'constinducedSemanticOffsets=Object.freeze(induced.map(({semanticOffset})=>semanticOffset))',
      'buildGraphKernel({nodeKeys,edges:inducedEdges})',
      'collectBarrierRegionOwnership(kernel,graphOrder,preflight.queries)',
    ],
  },
  {
    path: 'src/definition/compilation/classify-fork-regions.ts',
    name: 'edgeIsPermitted',
    required: [
      'constfromOwner=owners.get(edge.from)',
      'consttoOwner=owners.get(edge.to)',
      'fromOwner!==undefined&&edge.from===exits.get(fromOwner)&&edge.to===join.key',
      'edge.from===fork.key&&toOwner!==undefined',
      'fromOwner!==undefined&&fromOwner===toOwner',
      'edge.from===fork.key&&edge.to===join.key',
      'fromOwner===undefined&&toOwner===undefined',
      'permittedExit||permittedEntry||permittedInternal||directBarrier',
    ],
  },
  {
    path: 'src/definition/compilation/classify-fork-regions.ts',
    name: 'classifyBranchReadiness',
    required: [],
  },
  {
    path: 'src/definition/compilation/classify-fork-regions.ts',
    name: 'classifyForkRegions',
    required: [
      'constresult=fork.queryIndex===undefined?undefined:graph.ownership[fork.queryIndex]',
      'classifyBranchReadiness(fork,branch,members,graph,nodeByKey,sourceIndexes,faults)',
      'graph.edges.length===graph.inducedEdges.length',
      'graph.inducedSemanticOffsets[offset]===offset',
      'graph.inducedEdges[offset]?.from===edge.from',
      'graph.inducedEdges[offset]?.outcome===edge.outcome',
      'graph.inducedEdges[offset]?.to===edge.to',
      "if(faults.length===0&&!identical){faults.push({code:'DEF_TYPE',path:'/nodes'",
    ],
  },
  {
    path: 'src/definition/compilation/assemble-compiled-pipeline.ts',
    name: 'deepFreeze',
    required: [
      "typeofvalue!=='object'||value===null||Object.isFrozen(value)",
      'for(constkeyofReflect.ownKeys(value))',
      "if(descriptor&&'value'indescriptor){deepFreeze(descriptor.value);}",
      'returnObject.freeze(value)',
    ],
  },
  {
    path: 'src/definition/compilation/assemble-compiled-pipeline.ts',
    name: 'buildIndexes',
    required: ['nodeIndex:nodes.map((node,index)=>({key:node.key,node:index}))'],
  },
  {
    path: 'src/definition/compilation/assemble-compiled-pipeline.ts',
    name: 'assembleCompiledPipeline',
    required: [
      'schemaVersion:1,entry,facts:sortedFacts,nodes',
      'topologicalOrder:graph.topologicalOrder,forkRegions',
    ],
  },
] as const;

const COMPILER_AST_SEMANTIC_CONTRACTS = [
  {
    path: 'src/definition/compilation/normalize-pipeline-node.ts',
    name: 'normalizePipelineNode',
    validates: validatesHumanGateNormalization,
  },
  {
    path: 'src/definition/compilation/project-pipeline-edges.ts',
    name: 'edgesForNode',
    validates: validatesHumanGateProjection,
  },
  {
    path: 'src/definition/compilation/preflight-fork-regions.ts',
    name: 'preflightForkRegions',
    validates: validatesPreflightQuery,
  },
  {
    path: 'src/definition/compilation/classify-fork-regions.ts',
    name: 'classifyBranchReadiness',
    validates: validatesReadinessAssignments,
  },
] as const;

const validateCompilerLeafSemantics = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): void => {
  for (const contract of COMPILER_SEMANTIC_CONTRACTS) {
    const module = modules.find((candidate) => candidate.path === contract.path);
    const owner = findFunction(modules, contract.path, contract.name);
    if (!module || !owner) {
      add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
      continue;
    }
    const source = compactSource(owner.getText());
    if (contract.required.some((required) => !source.includes(compactSource(required)))) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, owner);
    }
  }
  for (const contract of COMPILER_AST_SEMANTIC_CONTRACTS) {
    const module = modules.find((candidate) => candidate.path === contract.path);
    const owner = findFunction(modules, contract.path, contract.name);
    if (!module || !owner) {
      add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
      continue;
    }
    if (!contract.validates(owner)) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, owner);
    }
  }
  const assemblyModule = modules.find(
    (candidate) => candidate.path === 'src/definition/compilation/assemble-compiled-pipeline.ts',
  );
  const assembler = findFunction(
    modules,
    'src/definition/compilation/assemble-compiled-pipeline.ts',
    'assembleCompiledPipeline',
  );
  const indexBuilder = findFunction(
    modules,
    'src/definition/compilation/assemble-compiled-pipeline.ts',
    'buildIndexes',
  );
  if (!assemblyModule || !assembler || !indexBuilder) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', assemblyModule);
  } else if (!validatesAssemblyPromotion(assembler) || !validatesAssemblyIndexes(indexBuilder)) {
    add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', assemblyModule, assembler);
  }
};

const validateTrackedImports = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): void => {
  for (const module of modules) {
    const localNames = new Map<string, string>();
    for (const statement of module.sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause) {
        continue;
      }
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        if (TRACKED_NAMES.has(bindings.name.text)) {
          add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module, bindings);
        }
        continue;
      }
      if (!bindings || !ts.isNamedImports(bindings)) {
        continue;
      }
      const specifier =
        ts.isStringLiteral(statement.moduleSpecifier) ||
        ts.isNoSubstitutionTemplateLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : undefined;
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (!TRACKED_NAMES.has(imported)) {
          continue;
        }
        const prior = localNames.get(element.name.text);
        if (prior !== undefined || imported !== element.name.text) {
          add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module, element);
        }
        if (
          !specifier ||
          !specifier.startsWith('.') ||
          !modules.some(
            (candidate) =>
              candidate.path ===
              posix.normalize(posix.join(dirname(module.path), specifier.replace(/\.js$/u, '.ts'))),
          )
        ) {
          add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module, element);
        }
        localNames.set(element.name.text, imported);
      }
    }

    for (const node of descendants(module.sourceFile)) {
      if (
        (ts.isElementAccessExpression(node) &&
          propertyName(node) !== undefined &&
          TRACKED_NAMES.has(propertyName(node) ?? '')) ||
        (ts.isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword)
      ) {
        add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module, node);
      }
    }
  }
};

const validateBuilderReferences = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): readonly BuilderCall[] => {
  const calls: BuilderCall[] = [];
  for (const module of modules) {
    for (const reference of identifierReferences(module.sourceFile, 'buildGraphKernel')) {
      const parent = reference.parent;
      const isImport =
        ts.isImportSpecifier(parent) &&
        (parent.name === reference || parent.propertyName === reference);
      const isExport =
        ts.isExportSpecifier(parent) &&
        (parent.name === reference || parent.propertyName === reference) &&
        module.path === 'src/graph/index.ts';
      const isDeclaration =
        (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent)) &&
        parent.name === reference;
      const isDirectCall = ts.isCallExpression(parent) && parent.expression === reference;
      if (isDirectCall) {
        calls.push({
          module,
          call: parent,
          declaration: declarationOfCall(parent),
          owner: containingFunction(parent),
        });
      } else if (!isImport && !isExport && !isDeclaration) {
        add(violations, 'GRAPH_KERNEL_BUILD_SITE', module, reference);
      }
    }
  }
  return calls;
};

const validateBuilderCalls = (
  calls: readonly BuilderCall[],
  violations: ArchitectureViolation[],
): void => {
  if (calls.length !== 2) {
    add(violations, 'GRAPH_KERNEL_BUILD_SITE', undefined);
  }
  for (const builder of calls) {
    const expectedOwner = ALLOWED_BUILDERS.get(builder.module.path);
    const actualOwner = builder.owner ? functionName(builder.owner) : undefined;
    if (!expectedOwner || actualOwner !== expectedOwner) {
      let ancestor = builder.owner?.parent;
      let nestedInExpectedOwner = false;
      while (ancestor) {
        if (isFunctionLikeDeclaration(ancestor) && functionName(ancestor) === expectedOwner) {
          nestedInExpectedOwner = true;
          break;
        }
        ancestor = ancestor.parent;
      }
      if (nestedInExpectedOwner) {
        add(violations, 'GRAPH_KERNEL_BUILD_REPEAT', builder.module, builder.call);
      }
      add(violations, 'GRAPH_KERNEL_BUILD_SITE', builder.module, builder.call);
      continue;
    }
    if (
      !builder.declaration ||
      !isConstDeclaration(builder.declaration) ||
      !ts.isIdentifier(builder.declaration.name)
    ) {
      add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', builder.module, builder.call);
    }
    if (insideRepeatableConstruct(builder.call, builder.owner)) {
      add(violations, 'GRAPH_KERNEL_BUILD_REPEAT', builder.module, builder.call);
    }
  }
  for (const [path, owner] of ALLOWED_BUILDERS) {
    const ownedCalls = calls.filter(
      (builder) =>
        builder.module.path === path && builder.owner && functionName(builder.owner) === owner,
    );
    if (ownedCalls.length > 1) {
      for (const builder of ownedCalls.slice(1)) {
        add(violations, 'GRAPH_KERNEL_REBUILD', builder.module, builder.call);
      }
    }
  }
};

const validateCompiler = (
  modules: readonly ParsedModule[],
  call: BuilderCall | undefined,
  violations: ArchitectureViolation[],
): void => {
  const facadeModule = modules.find((entry) => entry.path === 'src/definition/compile-pipeline.ts');
  const graphModule = modules.find(
    (entry) => entry.path === 'src/definition/compilation/validate-definition-graph.ts',
  );
  const facade = findFunction(modules, 'src/definition/compile-pipeline.ts', 'compilePipeline');
  const graphOwner = call?.owner;
  if (!facadeModule || !graphModule || !facade || !call || !graphOwner) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', facadeModule ?? graphModule);
    return;
  }

  const facadeCalls = [
    'validateDefinition',
    'projectPipelineEdges',
    'preflightForkRegions',
    'validateDefinitionGraph',
    'classifyForkRegions',
    'assembleCompiledPipeline',
  ].map((name) => directCalls(facade, name)[0]);
  const positions = facadeCalls.map((candidate) => candidate?.getStart() ?? -1);
  const exactCallChain =
    facadeCalls.every(
      (candidate, index) =>
        candidate !== undefined &&
        directCalls(
          facade,
          [
            'validateDefinition',
            'projectPipelineEdges',
            'preflightForkRegions',
            'validateDefinitionGraph',
            'classifyForkRegions',
            'assembleCompiledPipeline',
          ][index]!,
        ).length === 1 &&
        isDirectTopLevelCall(facade, candidate),
    ) && positions.every((position, index) => index === 0 || position > positions[index - 1]!);
  const facadeText = facade.getText();
  const classificationGraph = objectProperty(facadeCalls[4]?.arguments[0], 'graph');
  const assemblyGraph = objectProperty(facadeCalls[5]?.arguments[0], 'graph');
  const exactDataFlow =
    identifierReferences(facade, 'normalizePipelineNode').length === 1 &&
    facadeText.includes('const projectedGraph = projectPipelineEdges(copiedNodes)') &&
    facadeText.includes(
      'preflightForkRegions(copiedNodes, nodeKeys, sourceIndexes, sourceNodes, faults)',
    ) &&
    facadeText.includes('edges: projectedGraph.edges') &&
    facadeText.includes('const classifiedRegions = classifyForkRegions({') &&
    classificationGraph !== undefined &&
    ts.isIdentifier(classificationGraph) &&
    classificationGraph.text === 'graph' &&
    assemblyGraph !== undefined &&
    ts.isIdentifier(assemblyGraph) &&
    assemblyGraph.text === 'graph';
  if (!exactCallChain || !exactDataFlow) {
    add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', facadeModule, facade);
  }
  const validationCall = facadeCalls[0];
  const validationStatement = validationCall
    ? topLevelStatement(facade, validationCall)
    : undefined;
  const facadeStatements: readonly Node[] =
    facade.body && ts.isBlock(facade.body) ? facade.body.statements : [];
  const validationIndex = validationStatement ? facadeStatements.indexOf(validationStatement) : -1;
  const validationGuard = validationIndex >= 0 ? facadeStatements[validationIndex + 1] : undefined;
  if (
    !isTerminatingGuard(validationGuard) ||
    validationGuard.expression.getText() !== '!validation.canCompile'
  ) {
    add(violations, 'GRAPH_KERNEL_TRUST_DOMINANCE', facadeModule, validationGuard ?? facade);
  }

  const ownerStatements: readonly Node[] =
    graphOwner.body && ts.isBlock(graphOwner.body) ? graphOwner.body.statements : [];
  const input = call.call.arguments[0];
  const nodeKeys = objectProperty(input, 'nodeKeys');
  const builderEdges = objectProperty(input, 'edges');
  const edgesDeclaration = localConst(graphOwner, 'edges');
  const knownKeys = localConst(graphOwner, 'knownKeys');
  const induced = localConst(graphOwner, 'induced');
  const inducedEdges = localConst(graphOwner, 'inducedEdges');
  const inducedSemanticOffsets = localConst(graphOwner, 'inducedSemanticOffsets');
  const ownership = directCalls(graphOwner, 'collectBarrierRegionOwnership')[0];
  const builderStatement = topLevelStatement(graphOwner, call.call);
  const builderIndex = builderStatement ? ownerStatements.indexOf(builderStatement) : -1;
  const inputIsExact =
    input !== undefined &&
    ts.isObjectLiteralExpression(input) &&
    nodeKeys !== undefined &&
    ts.isIdentifier(nodeKeys) &&
    nodeKeys.text === 'nodeKeys' &&
    builderEdges !== undefined &&
    ts.isIdentifier(builderEdges) &&
    builderEdges.text === 'inducedEdges';
  const inducedBindingsExist =
    edgesDeclaration !== undefined &&
    knownKeys !== undefined &&
    induced !== undefined &&
    inducedEdges !== undefined &&
    inducedSemanticOffsets !== undefined;
  const inducedEndpointProvenance = graphOwner
    .getText()
    .includes('knownKeys.has(edge.from) && knownKeys.has(edge.to)');
  const ownershipIsDirect =
    ownership !== undefined &&
    isDirectTopLevelCall(graphOwner, ownership) &&
    ownership.getStart() > call.call.getStart();
  const sizeGuardDominates =
    builderIndex > 0 &&
    ownerStatements
      .slice(0, builderIndex)
      .some(
        (statement) =>
          isTerminatingGuard(statement) &&
          statement.expression.getText().includes('nodeKeys.length') &&
          statement.expression.getText().includes('inducedEdges.length'),
      );
  for (const [proven, node] of [
    [inputIsExact, call.call],
    [inducedBindingsExist, induced ?? call.call],
    [inducedEndpointProvenance, induced ?? call.call],
    [ownershipIsDirect, ownership ?? call.call],
    [sizeGuardDominates, builderStatement ?? call.call],
  ] as const) {
    if (!proven) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', graphModule, node);
    }
  }
  for (const forbidden of ['buildEdgeBuckets', 'collectSemanticRegionMembers']) {
    if (modules.some((module) => identifierReferences(module.sourceFile, forbidden).length > 0)) {
      add(violations, 'GRAPH_KERNEL_REBUILD', graphModule, graphModule.sourceFile);
    }
  }
  const mutatingMethods = new Set([
    'copyWithin',
    'fill',
    'pop',
    'push',
    'reverse',
    'shift',
    'sort',
    'splice',
    'unshift',
  ]);
  for (const node of descendants(graphOwner)) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      (node.expression.expression.text === 'inducedEdges' ||
        node.expression.expression.text === 'inducedSemanticOffsets') &&
      mutatingMethods.has(node.expression.name.text)
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', graphModule, node);
    }
  }
  for (const definitionModule of modules.filter((module) =>
    module.path.startsWith('src/definition/'),
  )) {
    for (const node of descendants(definitionModule.sourceFile)) {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) &&
        (node.left.name.text === 'from' ||
          node.left.name.text === 'to' ||
          node.left.name.text === 'outcome')
      ) {
        add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', definitionModule, node);
      }
    }
  }
  const kernelName = nameOf(call.declaration?.name);
  if (!kernelName) {
    return;
  }
  const kernelDeclaration = descendants(graphOwner).find(
    (node): node is VariableDeclaration =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'kernel' &&
      initializerText(node) === `${kernelName}.kernel`,
  );
  if (!kernelDeclaration || !isConstDeclaration(kernelDeclaration)) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', graphModule, call.call);
  }
  const classificationModule = modules.find(
    (entry) => entry.path === 'src/definition/compilation/classify-fork-regions.ts',
  );
  const classification = findFunction(
    modules,
    'src/definition/compilation/classify-fork-regions.ts',
    'classifyForkRegions',
  );
  if (
    !classificationModule ||
    !classification ||
    !classification.getText().includes('graph.inducedSemanticOffsets[offset] === offset &&') ||
    !classification.getText().includes('graph.inducedEdges[offset]?.from === edge.from &&') ||
    !classification.getText().includes('graph.inducedEdges[offset]?.outcome === edge.outcome &&') ||
    !classification.getText().includes('graph.inducedEdges[offset]?.to === edge.to')
  ) {
    add(
      violations,
      'GRAPH_KERNEL_INPUT_PROVENANCE',
      classificationModule,
      classification ?? classificationModule?.sourceFile,
    );
  }
};

const validateInternalValidator = (
  modules: readonly ParsedModule[],
  call: BuilderCall | undefined,
  violations: ArchitectureViolation[],
): void => {
  const module = modules.find(
    (entry) => entry.path === 'src/transition/compiled/validate-compiled-internally.ts',
  );
  const owner = call?.owner;
  if (!module || !call || !owner) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
    return;
  }
  const statements =
    owner.body && ts.isBlock(owner.body) ? ([...owner.body.statements] as readonly Node[]) : [];
  const compactStatements = statements.map((statement) => compactSource(statement.getText()));
  const exactFlow = [
    'if(!precheckCompiledBounds(input)){return{ok:false};}',
    'constsnapshot=snapshotCompiledInput(input);',
    'if(snapshot===undefined||!validateCompiledMembers(snapshot)){return{ok:false};}',
    'constexpected=deriveExpectedCompiledSemantics(snapshot.nodes);',
    'if(expected===undefined||!compareSerializedGraph(snapshot,expected)){return{ok:false};}',
    'constbuilt=buildGraphKernel({nodeKeys:expected.nodeKeys,edges:expected.edges});',
    'if(!built.ok){return{ok:false};}',
    'constkernel=built.kernel;',
    'consttopologicalOffsets=verifySerializedTopology(snapshot,kernel);',
    'if(topologicalOffsets===undefined||!verifySerializedIndexes(snapshot,kernel)){return{ok:false};}',
    'returnObject.freeze({ok:true,snapshot,kernel,topologicalOffsets});',
  ];
  if (
    functionName(owner) !== 'validateCompiledInternally' ||
    !isDirectTopLevelCall(owner, call.call) ||
    compactStatements.length !== exactFlow.length ||
    compactStatements.some((statement, index) => statement !== exactFlow[index])
  ) {
    add(violations, 'GRAPH_KERNEL_TRUST_DOMINANCE', module, call.call);
  }
  const input = call.call.arguments[0];
  const nodeKeys = objectProperty(input, 'nodeKeys');
  const edges = objectProperty(input, 'edges');
  if (
    !input ||
    !ts.isObjectLiteralExpression(input) ||
    !exactPropertyPath(nodeKeys, ['expected', 'nodeKeys']) ||
    !edges ||
    !exactPropertyPath(edges, ['expected', 'edges']) ||
    !hasExactObjectProperties(input, ['nodeKeys', 'edges'])
  ) {
    add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, call.call);
  }
  const buildName = nameOf(call.declaration?.name);
  const kernelDeclaration = descendants(owner).find(
    (node): node is VariableDeclaration =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'kernel' &&
      initializerText(node) === `${buildName}.kernel`,
  );
  const returnWithKernel = descendants(owner).some(
    (node) =>
      ts.isReturnStatement(node) &&
      compactSource(node.expression?.getText() ?? '') ===
        'Object.freeze({ok:true,snapshot,kernel,topologicalOffsets})',
  );
  if (
    !buildName ||
    !kernelDeclaration ||
    !isConstDeclaration(kernelDeclaration) ||
    !returnWithKernel
  ) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, call.call);
  }
  const topologyCall = directCalls(owner, 'verifySerializedTopology')[0];
  const indexesCall = directCalls(owner, 'verifySerializedIndexes')[0];
  if (
    topologyCall?.arguments[0]?.getText() !== 'snapshot' ||
    topologyCall.arguments[1]?.getText() !== 'kernel' ||
    indexesCall?.arguments[0]?.getText() !== 'snapshot' ||
    indexesCall.arguments[1]?.getText() !== 'kernel'
  ) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, topologyCall ?? indexesCall ?? call.call);
  }
  const equalityGuardEnd = statements[4]?.end ?? -1;
  for (const node of descendants(owner)) {
    if (
      node.getStart() > equalityGuardEnd &&
      ts.isCallExpression(node) &&
      ((ts.isPropertyAccessExpression(node.expression) &&
        exactPropertyPath(node.expression.expression, ['Reflect']) &&
        node.expression.name.text === 'set' &&
        node.arguments[0]?.getText().startsWith('expected.')) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText().startsWith('expected.') &&
          [
            'copyWithin',
            'fill',
            'pop',
            'push',
            'reverse',
            'shift',
            'sort',
            'splice',
            'unshift',
          ].includes(node.expression.name.text)))
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
  }
};

const validateHostileDerivation = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): void => {
  const module = modules.find(
    (entry) => entry.path === 'src/transition/compiled/derive-expected-compiled-semantics.ts',
  );
  const owner = findFunction(
    modules,
    'src/transition/compiled/derive-expected-compiled-semantics.ts',
    'deriveExpectedCompiledSemantics',
  );
  if (!module || !owner) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
    return;
  }
  const owners = (name: string): readonly FunctionLikeDeclaration[] =>
    descendants(module.sourceFile).filter(
      (node): node is FunctionLikeDeclaration =>
        isFunctionLikeDeclaration(node) && functionName(node) === name,
    );
  const edgeFactories = owners('edgeFor');
  const comparators = owners('edgeComparator');
  const projectors = owners('expectedEdgesForNode');
  if (
    edgeFactories.length !== 1 ||
    comparators.length !== 1 ||
    projectors.length !== 1 ||
    !edgeFactories[0] ||
    !comparators[0] ||
    !projectors[0]
  ) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module, owner);
    return;
  }
  const semanticBodies = [
    [
      edgeFactories[0],
      `({
        from,
        outcome,
        to,
        role: 'activation',
        fork: null,
        branch: null,
      })`,
    ],
    [
      comparators[0],
      `compareUnicodeCodePoints(left.from, right.from) ||
       compareUnicodeCodePoints(left.outcome, right.outcome) ||
       compareUnicodeCodePoints(left.to, right.to) ||
       compareUnicodeCodePoints(left.role, right.role) ||
       compareUnicodeCodePoints(left.fork ?? '', right.fork ?? '') ||
       compareUnicodeCodePoints(left.branch ?? '', right.branch ?? '')`,
    ],
    [
      projectors[0],
      `{
        if (node.kind === 'task' || node.kind === 'join' || node.kind === 'consensus') {
          return Object.entries(node.outcomes).map(([outcome, to]) =>
            edgeFor(node.key, outcome, to)
          );
        }
        if (node.kind === 'fork') {
          return [
            ...node.branches.map((branch) => ({
              ...edgeFor(node.key, 'forked', branch.entry),
              fork: node.key,
              branch: branch.name,
            })),
            { ...edgeFor(node.key, 'forked', node.join), fork: node.key },
          ];
        }
        if (node.kind === 'humanGate') {
          return node.resolutions.map((route) =>
            edgeFor(node.key, route.resolution, route.to)
          );
        }
        if (node.kind === 'branch') {
          return [
            ...node.cases.map((entry) => edgeFor(node.key, entry.name, entry.to)),
            ...(node.default
              ? [edgeFor(node.key, node.default.name, node.default.to)]
              : []),
          ];
        }
        return node.kind === 'terminal' ? [] : undefined;
      }`,
    ],
  ] as const;
  for (const [semanticOwner, expectedBody] of semanticBodies) {
    if (
      !semanticOwner.body ||
      compactSource(semanticOwner.body.getText()) !== compactSource(expectedBody)
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, semanticOwner);
    }
  }
  const edges = localConst(owner, 'edges');
  const regions = localConst(owner, 'regions');
  const pushes = descendants(owner).filter(
    (node): node is CallExpression =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      exactPropertyPath(node.expression.expression, ['edges']) &&
      node.expression.name.text === 'push',
  );
  const sorts = descendants(owner).filter(
    (node): node is CallExpression =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      exactPropertyPath(node.expression.expression, ['edges']) &&
      node.expression.name.text === 'sort',
  );
  const returns = descendants(owner).filter(ts.isReturnStatement);
  const success = returns.find(
    (statement) =>
      statement.expression !== undefined && ts.isObjectLiteralExpression(statement.expression),
  )?.expression;
  const hostileNames =
    /\b(?:pipeline|input)\.(?:edges|forkRegions|incomingIndex|nodeIndex|outgoingIndex|topologicalOrder)\b/u;
  if (
    !edges?.initializer ||
    !ts.isArrayLiteralExpression(edges.initializer) ||
    edges.initializer.elements.length !== 0 ||
    pushes.length !== 1 ||
    compactSource(pushes[0]?.getText() ?? '') !== 'edges.push(...nodeEdges)' ||
    sorts.length !== 1 ||
    compactSource(sorts[0]?.getText() ?? '') !== 'edges.sort(edgeComparator)' ||
    !regions ||
    !success ||
    !hasExactObjectProperties(success, ['nodeKeys', 'edges', 'regions']) ||
    !exactPropertyPath(objectProperty(success, 'edges'), ['edges']) ||
    !exactPropertyPath(objectProperty(success, 'regions'), ['regions']) ||
    compactSource(objectProperty(success, 'nodeKeys')?.getText() ?? '') !==
      'nodes.map((node)=>node.key)' ||
    hostileNames.test(module.sourceFile.getText())
  ) {
    add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, owner);
  }
  const edgeAliases = new Set(['edges']);
  let aliasAdded = true;
  while (aliasAdded) {
    aliasAdded = false;
    for (const node of descendants(owner)) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        edgeAliases.has(node.initializer.text) &&
        !edgeAliases.has(node.name.text)
      ) {
        edgeAliases.add(node.name.text);
        aliasAdded = true;
      }
    }
  }
  if (edgeAliases.size > 1) {
    const alias = descendants(owner).find(
      (node): node is VariableDeclaration =>
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        edgeAliases.has(node.name.text) &&
        node.name.text !== 'edges',
    );
    add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, alias ?? owner);
  }
  for (const node of descendants(owner)) {
    if (
      ts.isCallExpression(node) &&
      node.arguments.some(
        (argument) => ts.isIdentifier(argument) && edgeAliases.has(argument.text),
      ) &&
      !callNamed(node, 'deriveRegions')
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
  }
  const allowedReflectFields = new Set(['branch', 'fork', 'role']);
  const reflectWrites = descendants(module.sourceFile).filter(
    (node): node is CallExpression =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      exactPropertyPath(node.expression.expression, ['Reflect']) &&
      node.expression.name.text === 'set',
  );
  if (
    reflectWrites.length !== 3 ||
    reflectWrites.some((write) => {
      const field = write.arguments[1];
      return (
        !exactPropertyPath(write.arguments[0], ['edge']) ||
        !field ||
        !ts.isStringLiteral(field) ||
        !allowedReflectFields.has(field.text)
      );
    })
  ) {
    add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, reflectWrites[0] ?? owner);
  }
  for (const node of descendants(module.sourceFile)) {
    if (
      ts.isVariableDeclaration(node) &&
      node !== edges &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      node.initializer.text === 'edges'
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      (node.left.name.text === 'from' ||
        node.left.name.text === 'outcome' ||
        node.left.name.text === 'to')
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
  }
};

const validateHostileComparison = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): void => {
  const path = 'src/transition/compiled/compare-serialized-graph.ts';
  const module = modules.find((entry) => entry.path === path);
  const owners = (name: string): readonly FunctionLikeDeclaration[] =>
    module
      ? descendants(module.sourceFile).filter(
          (node): node is FunctionLikeDeclaration =>
            isFunctionLikeDeclaration(node) && functionName(node) === name,
        )
      : [];
  const edges = owners('edgesEqual');
  const regions = owners('regionsEqual');
  const compare = owners('compareSerializedGraph');
  if (
    !module ||
    edges.length !== 1 ||
    regions.length !== 1 ||
    compare.length !== 1 ||
    !edges[0] ||
    !regions[0] ||
    !compare[0]
  ) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
    return;
  }
  const exactBodies = [
    [
      edges[0],
      `actual.from === expected.from &&
       actual.outcome === expected.outcome &&
       actual.to === expected.to &&
       actual.role === expected.role &&
       actual.fork === expected.fork &&
       actual.branch === expected.branch`,
    ],
    [
      regions[0],
      `actual.fork === expected.fork &&
       actual.join === expected.join &&
       actual.branches.length === expected.branches.length &&
       actual.branches.every((branch, branchIndex) => {
         const expectedBranch = expected.branches?.[branchIndex];
         return (
           branch.name === expectedBranch?.name &&
           branch.entry === expectedBranch?.entry &&
           branch.exit === expectedBranch?.exit &&
           branch.members.length === expectedBranch?.members.length &&
           branch.members.every(
             (member, memberIndex) => member === expectedBranch?.members[memberIndex]
           )
         );
       })`,
    ],
    [
      compare[0],
      `snapshot.nodes.length === expected.nodeKeys.length &&
       snapshot.nodes.every((node, nodeIndex) => node.key === expected.nodeKeys[nodeIndex]) &&
       snapshot.edges.length === expected.edges.length &&
       snapshot.edges.every((edge, edgeIndex) => {
         const expectedEdge = expected.edges[edgeIndex];
         return expectedEdge !== undefined && edgesEqual(edge, expectedEdge);
       }) &&
       snapshot.forkRegions.length === expected.regions.length &&
       snapshot.forkRegions.every((region, regionIndex) => {
         const expectedRegion = expected.regions[regionIndex];
         return expectedRegion !== undefined && regionsEqual(region, expectedRegion);
       })`,
    ],
  ] as const;
  for (const [owner, expectedBody] of exactBodies) {
    if (
      !owner.body ||
      ts.isBlock(owner.body) ||
      compactSource(owner.body.getText()) !== compactSource(expectedBody)
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, owner);
    }
  }
};

const validateAdapter = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): void => {
  const module = modules.find(
    (entry) => entry.path === 'src/transition/validate-compiled-pipeline.ts',
  );
  const owner = findFunction(
    modules,
    'src/transition/validate-compiled-pipeline.ts',
    'validateCompiledPipeline',
  );
  if (!module || !owner) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
    return;
  }
  const validationCalls = directCalls(owner, 'validateCompiledInternally');
  const validationCall = validationCalls[0];
  if (
    validationCalls.length !== 1 ||
    !validationCall ||
    !isDirectTopLevelCall(owner, validationCall)
  ) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, owner);
  }
  if (
    directCalls(owner, 'buildGraphKernel').length > 0 ||
    identifierReferences(owner, 'kernel').length > 0
  ) {
    add(violations, 'GRAPH_KERNEL_ADAPTER_EXPOSURE', module, owner);
  }
  const statements =
    owner.body && ts.isBlock(owner.body) ? ([...owner.body.statements] as readonly Node[]) : [];
  const returned = statements[1];
  const expression = returned && ts.isReturnStatement(returned) ? returned.expression : undefined;
  const success =
    expression && ts.isConditionalExpression(expression) ? expression.whenTrue : undefined;
  const failure =
    expression && ts.isConditionalExpression(expression) ? expression.whenFalse : undefined;
  if (
    statements.length !== 2 ||
    !expression ||
    !ts.isConditionalExpression(expression) ||
    !exactPropertyPath(expression.condition, ['validated', 'ok']) ||
    !hasExactObjectProperties(success, ['ok', 'pipeline']) ||
    !hasExactObjectProperties(failure, ['ok']) ||
    objectProperty(success, 'ok')?.kind !== SyntaxKind.TrueKeyword ||
    !exactPropertyPath(objectProperty(success, 'pipeline'), ['validated', 'snapshot']) ||
    objectProperty(failure, 'ok')?.kind !== SyntaxKind.FalseKeyword
  ) {
    add(violations, 'GRAPH_KERNEL_ADAPTER_EXPOSURE', module, returned ?? owner);
  }
};

const validateDecisionFlow = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): void => {
  const module = modules.find((entry) => entry.path === 'src/transition/decide-pipeline.ts');
  const decide = findFunction(modules, 'src/transition/decide-pipeline.ts', 'decidePipeline');
  const evaluator = findFunction(modules, 'src/transition/decide-pipeline.ts', 'evaluationIndex');
  if (!module || !decide || !evaluator) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
    return;
  }
  const validationCall = directCalls(decide, 'validateCompiledInternally')[0];
  if (
    directCalls(decide, 'validateCompiledInternally').length !== 1 ||
    directCalls(decide, 'evaluationIndex').length !== 1 ||
    !validationCall ||
    !isDirectTopLevelCall(decide, validationCall) ||
    validationCall.arguments.length !== 1 ||
    validationCall.arguments[0]?.getText() !== 'pipelineInput'
  ) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, decide);
  }
  const evaluationCall = directCalls(decide, 'evaluationIndex')[0];
  if (
    !evaluationCall ||
    evaluationCall.arguments[1]?.getText() !== 'compiled.kernel' ||
    evaluationCall.arguments[0]?.getText() !== 'compiled.snapshot' ||
    evaluationCall.arguments[2]?.getText() !== 'compiled.topologicalOffsets'
  ) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, evaluationCall ?? decide);
  }
  for (const [consumer, pipelineArgument] of [
    ['validateFactShape', 1],
    ['validateCausality', 0],
    ['reachedTerminals', 0],
    ['firstAction', 0],
    ['firstWait', 0],
  ] as const) {
    const calls = directCalls(decide, consumer);
    if (
      calls.length !== 1 ||
      calls[0]?.arguments[pipelineArgument]?.getText() !== 'compiled.snapshot'
    ) {
      add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, calls[0] ?? decide);
    }
  }
  const pipelineInputReferences = identifierReferences(decide, 'pipelineInput');
  if (
    pipelineInputReferences.length !== 2 ||
    pipelineInputReferences.some(
      (reference) =>
        reference !== decide.parameters[0]?.name && reference !== validationCall?.arguments[0],
    )
  ) {
    add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, pipelineInputReferences[2] ?? decide);
  }
  const parameters = evaluator.parameters;
  if (
    parameters.length < 2 ||
    nameOf(parameters[1]?.name) !== 'kernel' ||
    !parameters[1]?.type ||
    parameters[1].type.getText() !== 'GraphKernel'
  ) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, evaluator);
  }
  const evaluatorText = evaluator.getText();
  if (
    evaluatorText.includes('buildGraphKernel') ||
    evaluatorText.includes('structuredClone') ||
    /\{\s*\.\.\.kernel/u.test(evaluatorText) ||
    /new\s+(?:Map|WeakMap)\s*<[^>]*GraphKernel/u.test(evaluatorText) ||
    /pipeline\.edges\.(?:reduce|forEach|map)/u.test(evaluatorText) ||
    /(?:topologicalOrder|buildAdjacency)\s*\(/u.test(evaluatorText)
  ) {
    add(violations, 'GRAPH_KERNEL_REBUILD', module, evaluator);
  }
};

const validateRetainedState = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): void => {
  for (const module of modules) {
    for (const node of descendants(module.sourceFile)) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isVariableDeclarationList(node.parent) &&
        node.type &&
        typeNames(node.type).includes('GraphKernel')
      ) {
        if (ts.isSourceFile(node.parent.parent.parent)) {
          add(violations, 'GRAPH_KERNEL_CACHE', module, node);
        }
        if (node.type && /(?:Map|Set|WeakMap|WeakSet)\s*</u.test(node.type.getText())) {
          add(violations, 'GRAPH_KERNEL_CACHE', module, node);
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isVariableDeclarationList(node.parent) &&
        ts.isSourceFile(node.parent.parent.parent) &&
        node.initializer &&
        /new\s+(?:Map|Set|WeakMap|WeakSet)\s*<[^>]*GraphKernel/u.test(node.initializer.getText())
      ) {
        add(violations, 'GRAPH_KERNEL_CACHE', module, node);
      }
      if (
        ts.isPropertyDeclaration(node) &&
        node.type &&
        typeNames(node.type).includes('GraphKernel')
      ) {
        add(violations, 'GRAPH_KERNEL_CACHE', module, node);
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text.toLocaleLowerCase().includes('kernel') &&
        node.initializer &&
        ts.isConditionalExpression(node.initializer) &&
        node.initializer.getText().includes('kernel')
      ) {
        add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, node);
      }
      if (
        ts.isReturnStatement(node) &&
        node.expression &&
        (ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression)) &&
        identifierReferences(node.expression, 'kernel').length > 0
      ) {
        add(violations, 'GRAPH_KERNEL_CACHE', module, node);
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === SyntaxKind.EqualsToken &&
        (node.right.getText().includes('kernel') || node.left.getText().includes('kernel'))
      ) {
        add(
          violations,
          /^(?:global|globalThis|process)(?:\.|\[)/u.test(node.left.getText())
            ? 'GRAPH_KERNEL_CACHE'
            : 'GRAPH_KERNEL_IDENTITY_FLOW',
          module,
          node,
        );
      }
    }
  }
};

const validateSemanticResolution = (
  rootDirectory: string,
  violations: ArchitectureViolation[],
): void => {
  const configPath = join(rootDirectory, 'tsconfig.json');
  const api = new API({ cwd: rootDirectory });
  try {
    const project = api.updateSnapshot({ openProjects: [configPath] }).getProjects()[0];
    if (!project) {
      violations.push({ code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', path: 'src', line: 1 });
      return;
    }
    const diagnostics = [
      ...project.program.getConfigFileParsingDiagnostics(),
      ...project.program.getProgramDiagnostics(),
      ...project.program.getGlobalDiagnostics(),
      ...project.program.getSyntacticDiagnostics(),
      ...project.program.getBindDiagnostics(),
      ...project.program.getSemanticDiagnostics(),
    ];
    for (const diagnostic of diagnostics) {
      const absolutePath = diagnostic.fileName;
      const path = absolutePath ? normalizedPath(relative(rootDirectory, absolutePath)) : 'src';
      if (path !== 'src' && !path.startsWith('src/')) {
        continue;
      }
      const sourceFile = absolutePath ? project.program.getSourceFile(absolutePath) : undefined;
      const line =
        sourceFile && diagnostic.pos >= 0
          ? sourceFile.getLineAndCharacterOfPosition(diagnostic.pos).line + 1
          : 1;
      if (
        !violations.some(
          (entry) =>
            entry.code === 'GRAPH_KERNEL_ANALYSIS_UNPROVEN' &&
            entry.path === path &&
            entry.line === line,
        )
      ) {
        violations.push({ code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', path, line });
      }
    }

    const modules = project.program
      .getSourceFileNames()
      .filter((path) => normalizedPath(relative(rootDirectory, path)).startsWith('src/'))
      .map((path) => ({
        path: normalizedPath(relative(rootDirectory, path)),
        sourceFile: project.program.getSourceFile(path),
      }))
      .filter((module): module is ParsedModule => module.sourceFile !== undefined);
    const facadeModule = modules.find(
      (module) => module.path === 'src/definition/compile-pipeline.ts',
    );
    const facade = findFunction(modules, 'src/definition/compile-pipeline.ts', 'compilePipeline');
    const callTargets = [
      ['src/definition/validation/validate-definition.ts', 'validateDefinition'],
      ['src/definition/compilation/project-pipeline-edges.ts', 'projectPipelineEdges'],
      ['src/definition/compilation/preflight-fork-regions.ts', 'preflightForkRegions'],
      ['src/definition/compilation/validate-definition-graph.ts', 'validateDefinitionGraph'],
      ['src/definition/compilation/classify-fork-regions.ts', 'classifyForkRegions'],
      ['src/definition/compilation/assemble-compiled-pipeline.ts', 'assembleCompiledPipeline'],
    ] as const;
    if (!facadeModule || !facade) {
      add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', facadeModule);
      return;
    }
    const calls = callTargets.map(([path, name]) => {
      const target = findFunction(modules, path, name);
      return target ? resolvedCalls(project.checker, facade, target) : [];
    });
    const positions = calls.map((ownedCalls) => ownedCalls[0]?.getStart() ?? -1);
    if (
      calls.some(
        (ownedCalls) =>
          ownedCalls.length !== 1 ||
          ownedCalls[0] === undefined ||
          !isDirectTopLevelCall(facade, ownedCalls[0]),
      ) ||
      positions.some((position, index) => index > 0 && position <= positions[index - 1]!)
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', facadeModule, facade);
    }

    const normalizer = findFunction(
      modules,
      'src/definition/compilation/normalize-pipeline-node.ts',
      'normalizePipelineNode',
    );
    const normalizerIdentifier = normalizer ? functionIdentifier(normalizer) : undefined;
    const normalizerSymbol = normalizerIdentifier
      ? resolvedSymbolId(project.checker, normalizerIdentifier)
      : undefined;
    const normalizationReferences =
      normalizerSymbol === undefined
        ? []
        : descendants(facade).filter(
            (node): node is Identifier =>
              ts.isIdentifier(node) && resolvedSymbolId(project.checker, node) === normalizerSymbol,
          );
    if (
      normalizationReferences.length !== 1 ||
      !normalizationReferences[0] ||
      !ts.isCallExpression(normalizationReferences[0].parent) ||
      !ts.isPropertyAccessExpression(normalizationReferences[0].parent.expression) ||
      normalizationReferences[0].parent.expression.name.text !== 'map' ||
      normalizationReferences[0].parent.arguments[0] !== normalizationReferences[0]
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', facadeModule, facade);
    }

    const graphModule = modules.find(
      (module) => module.path === 'src/definition/compilation/validate-definition-graph.ts',
    );
    const graphOwner = findFunction(
      modules,
      'src/definition/compilation/validate-definition-graph.ts',
      'validateDefinitionGraph',
    );
    const referenceOwner = findFunction(
      modules,
      'src/definition/compilation/validate-definition-graph.ts',
      'validateReferences',
    );
    const referenceCalls =
      graphOwner && referenceOwner
        ? resolvedCalls(project.checker, graphOwner, referenceOwner)
        : [];
    if (
      !graphModule ||
      !graphOwner ||
      referenceCalls.length !== 1 ||
      !referenceCalls[0] ||
      !isDirectTopLevelCall(graphOwner, referenceCalls[0]) ||
      graphOwner.body === undefined ||
      !ts.isBlock(graphOwner.body) ||
      topLevelStatement(graphOwner, referenceCalls[0]) !== graphOwner.body.statements[0]
    ) {
      add(
        violations,
        'GRAPH_KERNEL_TRUST_DOMINANCE',
        graphModule,
        referenceCalls[0] ?? graphOwner ?? graphModule?.sourceFile,
      );
    }

    const hostilePath = 'src/transition/compiled/validate-compiled-internally.ts';
    const hostileModule = modules.find((module) => module.path === hostilePath);
    const hostileOwner = findFunction(modules, hostilePath, 'validateCompiledInternally');
    const hostileTargets = [
      ['src/transition/compiled/precheck-compiled-bounds.ts', 'precheckCompiledBounds'],
      ['src/transition/compiled/snapshot-compiled-input.ts', 'snapshotCompiledInput'],
      ['src/transition/compiled/validate-compiled-members.ts', 'validateCompiledMembers'],
      [
        'src/transition/compiled/derive-expected-compiled-semantics.ts',
        'deriveExpectedCompiledSemantics',
      ],
      ['src/transition/compiled/compare-serialized-graph.ts', 'compareSerializedGraph'],
      ['src/graph/build-graph-kernel.ts', 'buildGraphKernel'],
      ['src/transition/compiled/verify-serialized-topology.ts', 'verifySerializedTopology'],
      ['src/transition/compiled/verify-serialized-indexes.ts', 'verifySerializedIndexes'],
    ] as const;
    if (!hostileModule || !hostileOwner) {
      add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', hostileModule);
      return;
    }
    const hostileCalls = hostileTargets.map(([path, name]) => {
      const target = findFunction(modules, path, name);
      return target ? resolvedCalls(project.checker, hostileOwner, target) : [];
    });
    const hostilePositions = hostileCalls.map((ownedCalls) => ownedCalls[0]?.getStart() ?? -1);
    if (
      hostileCalls.some((ownedCalls) => ownedCalls.length !== 1) ||
      hostilePositions.some(
        (position, index) => index > 0 && position <= hostilePositions[index - 1]!,
      )
    ) {
      add(violations, 'GRAPH_KERNEL_TRUST_DOMINANCE', hostileModule, hostileOwner);
    }
    const inputParameter = hostileOwner.parameters[0]?.name;
    const inputSymbol =
      inputParameter && ts.isIdentifier(inputParameter)
        ? resolvedSymbolId(project.checker, inputParameter)
        : undefined;
    const inputReferences =
      inputSymbol === undefined
        ? []
        : descendants(hostileOwner).filter(
            (node): node is Identifier =>
              ts.isIdentifier(node) && resolvedSymbolId(project.checker, node) === inputSymbol,
          );
    if (inputReferences.length !== 3) {
      add(
        violations,
        'GRAPH_KERNEL_INPUT_PROVENANCE',
        hostileModule,
        inputReferences[3] ?? hostileOwner,
      );
    }

    const decisionModule = modules.find(
      (module) => module.path === 'src/transition/decide-pipeline.ts',
    );
    const decisionOwner = findFunction(
      modules,
      'src/transition/decide-pipeline.ts',
      'decidePipeline',
    );
    const validatorTarget = findFunction(modules, hostilePath, 'validateCompiledInternally');
    const decisionValidationCalls =
      decisionOwner && validatorTarget
        ? resolvedCalls(project.checker, decisionOwner, validatorTarget)
        : [];
    const pipelineParameter = decisionOwner?.parameters[0]?.name;
    const pipelineSymbol =
      pipelineParameter && ts.isIdentifier(pipelineParameter)
        ? resolvedSymbolId(project.checker, pipelineParameter)
        : undefined;
    const laterPipelineReads =
      decisionOwner && pipelineSymbol !== undefined && decisionValidationCalls[0]
        ? descendants(decisionOwner).filter(
            (node): node is Identifier =>
              ts.isIdentifier(node) &&
              node.getStart() > decisionValidationCalls[0]!.end &&
              resolvedSymbolId(project.checker, node) === pipelineSymbol,
          )
        : [];
    if (
      !decisionModule ||
      !decisionOwner ||
      decisionValidationCalls.length !== 1 ||
      laterPipelineReads.length !== 0
    ) {
      add(
        violations,
        'GRAPH_KERNEL_INPUT_PROVENANCE',
        decisionModule,
        laterPipelineReads[0] ?? decisionOwner ?? decisionModule?.sourceFile,
      );
    }
  } catch {
    violations.push({ code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', path: 'src', line: 1 });
  } finally {
    api.close();
  }
};

export const validateGraphKernelFlow = (
  rootDirectory: string,
): readonly ArchitectureViolation[] => {
  const violations: ArchitectureViolation[] = [];
  let sources: readonly { path: string; source: string }[];
  try {
    sources = collectSources(rootDirectory);
  } catch {
    return [{ code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', path: 'src', line: 1 }];
  }
  validateSemanticResolution(rootDirectory, violations);

  const virtualRoot = '/graph-kernel-flow';
  const configPath = `${virtualRoot}/tsconfig.json`;
  const files: Record<string, string> = {
    [configPath]: JSON.stringify({
      compilerOptions: { noLib: true, noResolve: true },
      files: sources.map((source) => `${virtualRoot}/${source.path}`),
    }),
  };
  for (const source of sources) {
    files[`${virtualRoot}/${source.path}`] = source.source;
  }

  const api = new API({ cwd: virtualRoot, fs: createVirtualFileSystem(files) });
  try {
    const project = api.updateSnapshot({ openProjects: [configPath] }).getProjects()[0];
    if (!project) {
      return [{ code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', path: 'src', line: 1 }];
    }
    const syntaxDiagnostics = project.program.getSyntacticDiagnostics();
    if (syntaxDiagnostics.length > 0) {
      violations.push({
        code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
        path: sources[0]?.path ?? 'src',
        line: 1,
      });
      return violations;
    }
    const modules: ParsedModule[] = [];
    for (const source of sources) {
      const sourceFile = project.program.getSourceFile(`${virtualRoot}/${source.path}`);
      if (!sourceFile) {
        violations.push({
          code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
          path: source.path,
          line: 1,
        });
      } else {
        modules.push({ path: source.path, sourceFile });
      }
    }
    for (const path of REQUIRED_PATHS) {
      if (!modules.some((module) => module.path === path)) {
        violations.push({ code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', path, line: 1 });
      }
    }
    validateTrackedImports(modules, violations);
    validateCompilerLeafSemantics(modules, violations);
    const calls = validateBuilderReferences(modules, violations);
    validateBuilderCalls(calls, violations);
    validateCompiler(
      modules,
      calls.find(
        (call) => call.module.path === 'src/definition/compilation/validate-definition-graph.ts',
      ),
      violations,
    );
    validateInternalValidator(
      modules,
      calls.find(
        (call) => call.module.path === 'src/transition/compiled/validate-compiled-internally.ts',
      ),
      violations,
    );
    validateHostileDerivation(modules, violations);
    validateHostileComparison(modules, violations);
    validateAdapter(modules, violations);
    validateDecisionFlow(modules, violations);
    validateRetainedState(modules, violations);
  } catch {
    violations.push({ code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', path: 'src', line: 1 });
  } finally {
    api.close();
  }
  return violations.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.line - right.line ||
      left.code.localeCompare(right.code),
  );
};
