import { createHash } from 'node:crypto';
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
import { API } from 'typescript/unstable/sync';

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
  'validateCompiledInternally',
  'validateCompiledPipeline',
]);

const ALLOWED_BUILDERS = new Map([
  ['src/definition/compile-pipeline.ts', 'compilePipeline'],
  ['src/transition/validate-compiled-internally.ts', 'canonicalCoreGraph'],
]);

const REQUIRED_PATHS = [
  'src/definition/compile-pipeline.ts',
  'src/graph/build-graph-kernel.ts',
  'src/graph/graph-kernel.ts',
  'src/graph/index.ts',
  'src/transition/decide-pipeline.ts',
  'src/transition/validate-compiled-internally.ts',
  'src/transition/validate-compiled-pipeline.ts',
  'src/transition/validated-compiled-pipeline.ts',
] as const;

const ACCEPTED_OWNER_DIGESTS = [
  {
    path: 'src/definition/compile-pipeline.ts',
    name: 'compilePipeline',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    digest: '5e601cebbdf06ebe1882a7a46b2ce1485ed27c331eafd94b4eca0362259c1669',
  },
  {
    path: 'src/definition/compile-pipeline.ts',
    name: 'preflightForkRegions',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    digest: 'f619d28422ddc193db794b6be3a10d851215cf271c135128f71f16be5aac5528',
  },
  {
    path: 'src/definition/compile-pipeline.ts',
    name: 'classifyForkRegions',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    digest: 'd4e293cc77b4548642ee22f8a3d18e4f079c829bd57ff08df5f2527a82f44eb1',
  },
  {
    path: 'src/transition/validate-compiled-internally.ts',
    name: 'validateCompiledInternally',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    digest: 'a67ae89bf1609012ca61ddb8af71d4d1977fb706a7fd5b5c716374677630aed6',
  },
  {
    path: 'src/transition/validate-compiled-internally.ts',
    name: 'canonicalCoreGraph',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    digest: '14bd423f973be6e501259781a512d0c217154189f53bd4e8561e914a9cc25267',
  },
  {
    path: 'src/transition/validate-compiled-internally.ts',
    name: 'canonicalRegions',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    digest: '7ed0e7ad7eccc190c19b6fefb899144d300c095d1fa0c55b221a5cfbbcdc3b9a',
  },
  {
    path: 'src/transition/validate-compiled-internally.ts',
    name: 'independentlyDerivedRegionMembers',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    digest: 'e34e5e22da2f182384cbffd75ade50e4aa25f194e8c9805033e9e9d9dd9cd084',
  },
] as const satisfies readonly {
  readonly path: string;
  readonly name: string;
  readonly code: GraphKernelRule;
  readonly digest: string;
}[];

const ACCEPTED_FILE_DIGESTS = [
  {
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    digest: 'f061385d4fa3ee91972301b589afc0a9a5c16de4ed00d2cab322011ce6f63acc',
  },
  {
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    digest: 'dff379567b2b2fac80d733e248f806182788127c13f7dece9959ed76f7a8958d',
  },
] as const satisfies readonly {
  readonly path: string;
  readonly code: GraphKernelRule;
  readonly digest: string;
}[];

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

const isNegatedCallGuard = (
  owner: FunctionLikeDeclaration,
  call: CallExpression | undefined,
): boolean => {
  if (!call) {
    return false;
  }
  const statement = topLevelStatement(owner, call);
  return (
    isTerminatingGuard(statement) &&
    ts.isPrefixUnaryExpression(call.parent) &&
    call.parent.operator === SyntaxKind.ExclamationToken &&
    descendants(statement.expression).includes(call)
  );
};

const isExactNegatedCallGuard = (
  owner: FunctionLikeDeclaration,
  call: CallExpression | undefined,
): boolean => {
  if (!isNegatedCallGuard(owner, call) || !call) {
    return false;
  }
  const statement = topLevelStatement(owner, call);
  return isTerminatingGuard(statement) && statement.expression === call.parent;
};

const isExactEdgeEqualityGuard = (
  owner: FunctionLikeDeclaration,
  call: CallExpression | undefined,
): boolean => {
  if (!call || !ts.isPropertyAccessExpression(call.expression)) {
    return false;
  }
  const statement = topLevelStatement(owner, call);
  if (
    !isTerminatingGuard(statement) ||
    !ts.isBinaryExpression(statement.expression) ||
    statement.expression.operatorToken.kind !== SyntaxKind.BarBarToken ||
    !ts.isPrefixUnaryExpression(call.parent) ||
    call.parent.operator !== SyntaxKind.ExclamationToken ||
    statement.expression.right !== call.parent
  ) {
    return false;
  }
  const countMismatch = statement.expression.left;
  return (
    ts.isBinaryExpression(countMismatch) &&
    countMismatch.operatorToken.kind === SyntaxKind.ExclamationEqualsEqualsToken &&
    JSON.stringify(propertyPath(countMismatch.left)) ===
      JSON.stringify(['pipeline', 'edges', 'length']) &&
    JSON.stringify(propertyPath(countMismatch.right)) ===
      JSON.stringify(['expectedEdges', 'length']) &&
    JSON.stringify(propertyPath(call.expression.expression)) ===
      JSON.stringify(['pipeline', 'edges']) &&
    call.expression.name.text === 'every'
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

const unwrapped = (node: Node): Node =>
  ts.isParenthesizedExpression(node) ? unwrapped(node.expression) : node;

const conjunctions = (node: Node): readonly Node[] => {
  const expression = unwrapped(node);
  return ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === SyntaxKind.AmpersandAmpersandToken
    ? [...conjunctions(expression.left), ...conjunctions(expression.right)]
    : [expression];
};

const strictEquality = (
  node: Node,
  left: (operand: Node) => boolean,
  right: (operand: Node) => boolean,
): boolean => {
  const expression = unwrapped(node);
  return (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === SyntaxKind.EqualsEqualsEqualsToken &&
    left(unwrapped(expression.left)) &&
    right(unwrapped(expression.right))
  );
};

const identifierNamed = (node: Node, name: string): boolean =>
  ts.isIdentifier(node) && node.text === name;

const elementOf = (node: Node, collection: string, index: string): boolean =>
  ts.isElementAccessExpression(node) &&
  identifierNamed(node.expression, collection) &&
  node.argumentExpression !== undefined &&
  identifierNamed(node.argumentExpression, index);

const propertyOf = (node: Node, owner: string, property: string): boolean =>
  ts.isPropertyAccessExpression(node) &&
  identifierNamed(node.expression, owner) &&
  node.name.text === property;

const elementProperty = (
  node: Node,
  collection: string,
  index: string,
  property: string,
): boolean =>
  ts.isPropertyAccessExpression(node) &&
  elementOf(node.expression, collection, index) &&
  node.name.text === property;

const exactCompilerOffsetIdentity = (declaration: VariableDeclaration | undefined): boolean => {
  const initializer = declaration?.initializer;
  if (!initializer) {
    return false;
  }
  const outer = conjunctions(initializer);
  if (outer.length !== 2) {
    return false;
  }
  const lengthEquality = outer.find((entry) =>
    strictEquality(
      entry,
      (left) => JSON.stringify(propertyPath(left)) === JSON.stringify(['edges', 'length']),
      (right) => JSON.stringify(propertyPath(right)) === JSON.stringify(['inducedEdges', 'length']),
    ),
  );
  const everyCall = outer.find(
    (entry): entry is CallExpression =>
      ts.isCallExpression(entry) &&
      ts.isPropertyAccessExpression(entry.expression) &&
      identifierNamed(entry.expression.expression, 'edges') &&
      entry.expression.name.text === 'every',
  );
  const callback = everyCall?.arguments[0];
  if (
    !lengthEquality ||
    !callback ||
    !ts.isArrowFunction(callback) ||
    callback.parameters.length !== 2 ||
    nameOf(callback.parameters[0]?.name) !== 'edge' ||
    nameOf(callback.parameters[1]?.name) !== 'offset' ||
    ts.isBlock(callback.body)
  ) {
    return false;
  }
  const predicates = conjunctions(callback.body);
  if (predicates.length !== 4) {
    return false;
  }
  const required = [
    (entry: Node): boolean =>
      strictEquality(
        entry,
        (left) => elementOf(left, 'inducedSemanticOffsets', 'offset'),
        (right) => identifierNamed(right, 'offset'),
      ),
    ...(['from', 'outcome', 'to'] as const).map(
      (property) =>
        (entry: Node): boolean =>
          strictEquality(
            entry,
            (left) => elementProperty(left, 'inducedEdges', 'offset', property),
            (right) => propertyOf(right, 'edge', property),
          ),
    ),
  ];
  return required.every((requirement) => predicates.some(requirement));
};

const isPositiveLengthGuard = (statement: Node | undefined, path: readonly string[]): boolean => {
  if (!isTerminatingGuard(statement) || !ts.isBinaryExpression(statement.expression)) {
    return false;
  }
  const condition = statement.expression;
  return (
    condition.operatorToken.kind === SyntaxKind.GreaterThanToken &&
    JSON.stringify(propertyPath(condition.left)) === JSON.stringify(path) &&
    ts.isNumericLiteral(condition.right) &&
    condition.right.text === '0'
  );
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

const earlierDirectCall = (
  owner: FunctionLikeDeclaration,
  call: CallExpression,
  name: string,
): CallExpression | undefined =>
  directCalls(owner, name).find(
    (candidate) => candidate.getStart() < call.getStart() && isDirectTopLevelCall(owner, candidate),
  );

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

const isPipelineNodeKeyMap = (node: Node | undefined): boolean => {
  if (
    !node ||
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== 'map'
  ) {
    return false;
  }
  const nodes = node.expression.expression;
  if (
    !ts.isPropertyAccessExpression(nodes) ||
    !ts.isIdentifier(nodes.expression) ||
    nodes.expression.text !== 'pipeline' ||
    nodes.name.text !== 'nodes'
  ) {
    return false;
  }
  const mapper = node.arguments[0];
  const parameter = mapper && ts.isArrowFunction(mapper) ? mapper.parameters[0] : undefined;
  return (
    mapper !== undefined &&
    ts.isArrowFunction(mapper) &&
    mapper.parameters.length === 1 &&
    parameter !== undefined &&
    ts.isIdentifier(parameter.name) &&
    ((ts.isPropertyAccessExpression(mapper.body) &&
      ts.isIdentifier(mapper.body.expression) &&
      mapper.body.expression.text === parameter.name.text &&
      mapper.body.name.text === 'key') ||
      (ts.isBlock(mapper.body) &&
        descendants(mapper.body).some(
          (candidate) =>
            ts.isReturnStatement(candidate) &&
            candidate.expression !== undefined &&
            ts.isPropertyAccessExpression(candidate.expression) &&
            candidate.expression.name.text === 'key',
        )))
  );
};

const callReceiverNamed = (node: Node, receiver: string, method: string): node is CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === receiver &&
  node.expression.name.text === method;

const isExpectedEdgesBuilderDeclaration = (node: VariableDeclaration): boolean => {
  if (
    !ts.isIdentifier(node.name) ||
    node.name.text !== 'built' ||
    !node.initializer ||
    !ts.isCallExpression(node.initializer) ||
    !callNamed(node.initializer, 'buildGraphKernel')
  ) {
    return false;
  }
  const edges = objectProperty(node.initializer.arguments[0], 'edges');
  return edges !== undefined && ts.isIdentifier(edges) && edges.text === 'expectedEdges';
};

const validateHostileExpectedEdgeWrites = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): void => {
  const module = modules.find(
    (entry) => entry.path === 'src/transition/validate-compiled-internally.ts',
  );
  const graphOwner = findFunction(
    modules,
    'src/transition/validate-compiled-internally.ts',
    'canonicalCoreGraph',
  );
  const regionOwner = findFunction(
    modules,
    'src/transition/validate-compiled-internally.ts',
    'canonicalRegions',
  );
  if (!module || !graphOwner || !regionOwner) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
    return;
  }

  const declaration = localConst(graphOwner, 'expectedEdges');
  const pushes = descendants(graphOwner).filter((node) =>
    callReceiverNamed(node, 'expectedEdges', 'push'),
  );
  const sorts = descendants(graphOwner).filter((node) =>
    callReceiverNamed(node, 'expectedEdges', 'sort'),
  );
  const push = pushes[0];
  const pushed = push?.arguments[0];
  const sort = sorts[0];
  const sortArgument = sort?.arguments[0];
  if (
    !declaration?.initializer ||
    !ts.isArrayLiteralExpression(declaration.initializer) ||
    declaration.initializer.elements.length !== 0 ||
    pushes.length !== 1 ||
    !pushed ||
    !ts.isSpreadElement(pushed) ||
    !ts.isIdentifier(pushed.expression) ||
    pushed.expression.text !== 'nodeEdges' ||
    sorts.length !== 1 ||
    sort?.arguments.length !== 1 ||
    !sortArgument ||
    !ts.isIdentifier(sortArgument) ||
    sortArgument.text !== 'edgeComparator'
  ) {
    add(
      violations,
      'GRAPH_KERNEL_INPUT_PROVENANCE',
      module,
      push ?? sort ?? declaration ?? graphOwner,
    );
  }

  const equalityCall = directCalls(graphOwner, 'every').find(
    (candidate) =>
      ts.isPropertyAccessExpression(candidate.expression) &&
      JSON.stringify(propertyPath(candidate.expression.expression)) ===
        JSON.stringify(['pipeline', 'edges']),
  );
  const equalityStatement = equalityCall ? topLevelStatement(graphOwner, equalityCall) : undefined;
  const equalityEnd = equalityStatement?.end ?? -1;
  for (const node of descendants(graphOwner)) {
    if (
      ts.isVariableDeclaration(node) &&
      node !== declaration &&
      node.initializer &&
      identifierReferences(node.initializer, 'expectedEdges').length > 0 &&
      !(
        ts.isIdentifier(node.name) &&
        node.name.text === 'expected' &&
        ts.isElementAccessExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'expectedEdges'
      ) &&
      !isExpectedEdgesBuilderDeclaration(node)
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments.some(
        (argument) => ts.isIdentifier(argument) && argument.text === 'expectedEdges',
      ) &&
      !callNamed(node, 'canonicalRegions')
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'expectedEdges' &&
      node.expression.name.text !== 'push' &&
      node.expression.name.text !== 'sort'
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
    if (
      equalityEnd >= 0 &&
      node.getStart() > equalityEnd &&
      callReceiverNamed(node, 'expectedEdges', 'push')
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
  }

  const reflectWrites = directCalls(regionOwner, 'set').filter(
    (call) =>
      ts.isPropertyAccessExpression(call.expression) &&
      ts.isIdentifier(call.expression.expression) &&
      call.expression.expression.text === 'Reflect',
  );
  const allowedFields = new Set(['branch', 'fork', 'role']);
  if (
    reflectWrites.length !== 3 ||
    reflectWrites.some((call) => {
      const target = call.arguments[0];
      const field = call.arguments[1];
      return (
        !target ||
        !ts.isIdentifier(target) ||
        target.text !== 'edge' ||
        !field ||
        !ts.isStringLiteral(field) ||
        !allowedFields.has(field.text)
      );
    })
  ) {
    add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, reflectWrites[0] ?? regionOwner);
  }
  for (const node of descendants(regionOwner)) {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isIdentifier(node.initializer) &&
      node.initializer.text === 'expectedEdges'
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ts.isIdentifier(node.left.expression) &&
      node.left.expression.text === 'edge'
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
  }
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

const validateAcceptedOwnerShapes = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): void => {
  for (const accepted of ACCEPTED_OWNER_DIGESTS) {
    const module = modules.find((candidate) => candidate.path === accepted.path);
    const owner = findFunction(modules, accepted.path, accepted.name);
    if (!module || !owner) {
      add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
      continue;
    }
    const digest = createHash('sha256').update(owner.getText()).digest('hex');
    if (digest !== accepted.digest) {
      add(violations, accepted.code, module, owner);
    }
  }
};

const validateAcceptedFileShapes = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): void => {
  for (const accepted of ACCEPTED_FILE_DIGESTS) {
    const module = modules.find((candidate) => candidate.path === accepted.path);
    if (!module) {
      add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
      continue;
    }
    const digest = createHash('sha256').update(module.sourceFile.text).digest('hex');
    if (digest !== accepted.digest) {
      add(violations, accepted.code, module, module.sourceFile);
    }
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
  const module = modules.find((entry) => entry.path === 'src/definition/compile-pipeline.ts');
  const owner = call?.owner;
  if (!module || !call || !owner) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
    return;
  }
  const portableCall = earlierDirectCall(owner, call.call, 'inspectPortableValueSet');
  const portableStatement = portableCall ? topLevelStatement(owner, portableCall) : undefined;
  const ownerStatements: readonly Node[] =
    owner.body && ts.isBlock(owner.body) ? owner.body.statements : [];
  const portableIndex = portableStatement ? ownerStatements.indexOf(portableStatement) : -1;
  const portableGuard = portableIndex >= 0 ? ownerStatements[portableIndex + 1] : undefined;
  if (
    !isDirectTopLevelCall(owner, call.call) ||
    !portableCall ||
    !portableCall.parent ||
    !ts.isVariableDeclaration(portableCall.parent) ||
    !ts.isIdentifier(portableCall.parent.name) ||
    portableCall.parent.name.text !== 'portable' ||
    !isPositiveLengthGuard(portableGuard, ['portable', 'issues', 'length']) ||
    !earlierDirectCall(owner, call.call, 'validateReferences')
  ) {
    add(violations, 'GRAPH_KERNEL_TRUST_DOMINANCE', module, call.call);
  }
  const input = call.call.arguments[0];
  const nodeKeys = objectProperty(input, 'nodeKeys');
  const builderEdges = objectProperty(input, 'edges');
  const nodeKeysDeclaration = localConst(owner, 'nodeKeys');
  const preliminaryEdges = localConst(owner, 'preliminaryEdges');
  const preflight = directCalls(owner, 'preflightForkRegions')[0];
  const edgesDeclaration = localConst(owner, 'edges');
  const knownKeys = localConst(owner, 'knownKeys');
  const induced = localConst(owner, 'induced');
  const inducedEdges = localConst(owner, 'inducedEdges');
  const inducedSemanticOffsets = localConst(owner, 'inducedSemanticOffsets');
  const ownership = directCalls(owner, 'collectBarrierRegionOwnership')[0];
  const builderStatement = topLevelStatement(owner, call.call);
  const builderIndex = builderStatement ? ownerStatements.indexOf(builderStatement) : -1;
  const hasPreGraphFaultExit = ownerStatements
    .slice(0, builderIndex < 0 ? 0 : builderIndex)
    .some((statement) => isPositiveLengthGuard(statement, ['faults', 'length']));
  const hasPostGraphFaultExit = ownerStatements
    .slice(builderIndex + 1)
    .some((statement) => isPositiveLengthGuard(statement, ['faults', 'length']));
  const offsetIdentity = localConst(owner, 'edgeOffsetsAreIdentical');
  const offsetGuard = offsetIdentity
    ? ownerStatements[
        ownerStatements.indexOf(topLevelStatement(owner, offsetIdentity) ?? owner) + 1
      ]
    : undefined;
  const inputIsExact =
    input !== undefined &&
    ts.isObjectLiteralExpression(input) &&
    nodeKeys !== undefined &&
    ts.isIdentifier(nodeKeys) &&
    nodeKeys.text === 'nodeKeys' &&
    builderEdges !== undefined &&
    ts.isIdentifier(builderEdges) &&
    builderEdges.text === 'inducedEdges';
  const nodesAreCanonical =
    nodeKeysDeclaration?.initializer !== undefined &&
    ts.isCallExpression(nodeKeysDeclaration.initializer) &&
    ts.isPropertyAccessExpression(nodeKeysDeclaration.initializer.expression) &&
    nodeKeysDeclaration.initializer.expression.name.text === 'map';
  const inducedBindingsExist =
    preliminaryEdges !== undefined &&
    edgesDeclaration !== undefined &&
    knownKeys !== undefined &&
    induced !== undefined &&
    inducedEdges !== undefined &&
    inducedSemanticOffsets !== undefined;
  const preflightIsDirect = preflight !== undefined && isDirectTopLevelCall(owner, preflight);
  const ownershipIsDirect =
    ownership !== undefined &&
    isDirectTopLevelCall(owner, ownership) &&
    ownership.getStart() > call.call.getStart();
  const finalGateIsExact =
    hasPostGraphFaultExit &&
    offsetIdentity !== undefined &&
    isTerminatingGuard(offsetGuard) &&
    ts.isPrefixUnaryExpression(offsetGuard.expression) &&
    offsetGuard.expression.operator === SyntaxKind.ExclamationToken &&
    ts.isIdentifier(offsetGuard.expression.operand) &&
    offsetGuard.expression.operand.text === 'edgeOffsetsAreIdentical' &&
    exactCompilerOffsetIdentity(offsetIdentity);
  for (const [proven, node] of [
    [inputIsExact, call.call],
    [nodesAreCanonical, nodeKeysDeclaration ?? call.call],
    [inducedBindingsExist, induced ?? call.call],
    [preflightIsDirect, preflight ?? call.call],
    [ownershipIsDirect, ownership ?? call.call],
    [finalGateIsExact, offsetGuard ?? call.call],
  ] as const) {
    if (!proven) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
  }
  if (hasPreGraphFaultExit) {
    add(violations, 'GRAPH_KERNEL_TRUST_DOMINANCE', module, call.call);
  }
  for (const forbidden of ['buildEdgeBuckets', 'collectSemanticRegionMembers']) {
    if (identifierReferences(module.sourceFile, forbidden).length > 0) {
      add(violations, 'GRAPH_KERNEL_REBUILD', module, module.sourceFile);
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
  for (const node of descendants(owner)) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      (node.expression.expression.text === 'inducedEdges' ||
        node.expression.expression.text === 'inducedSemanticOffsets') &&
      mutatingMethods.has(node.expression.name.text)
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
  }
  for (const node of descendants(module.sourceFile)) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      (node.left.name.text === 'from' ||
        node.left.name.text === 'to' ||
        node.left.name.text === 'outcome')
    ) {
      add(violations, 'GRAPH_KERNEL_INPUT_PROVENANCE', module, node);
    }
  }
  const kernelName = nameOf(call.declaration?.name);
  if (!kernelName) {
    return;
  }
  const kernelDeclaration = descendants(owner).find(
    (node): node is VariableDeclaration =>
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'kernel' &&
      initializerText(node) === `${kernelName}.kernel`,
  );
  if (!kernelDeclaration || !isConstDeclaration(kernelDeclaration)) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, call.call);
  }
};

const validateInternalValidator = (
  modules: readonly ParsedModule[],
  call: BuilderCall | undefined,
  violations: ArchitectureViolation[],
): void => {
  const module = modules.find(
    (entry) => entry.path === 'src/transition/validate-compiled-internally.ts',
  );
  const owner = call?.owner;
  if (!module || !call || !owner) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
    return;
  }
  const regionsGuard = directCalls(owner, 'canonicalRegions').find(
    (candidate) => candidate.getStart() < call.call.getStart(),
  );
  const equalityGuard = directCalls(owner, 'every').find(
    (candidate) => candidate.getStart() < call.call.getStart(),
  );
  if (
    !isDirectTopLevelCall(owner, call.call) ||
    !isExactNegatedCallGuard(owner, regionsGuard) ||
    !isExactEdgeEqualityGuard(owner, equalityGuard)
  ) {
    add(violations, 'GRAPH_KERNEL_TRUST_DOMINANCE', module, call.call);
  }
  const input = call.call.arguments[0];
  const nodeKeys = objectProperty(input, 'nodeKeys');
  const edges = objectProperty(input, 'edges');
  const expectedEdges = localConst(owner, 'expectedEdges');
  if (
    !input ||
    !ts.isObjectLiteralExpression(input) ||
    !isPipelineNodeKeyMap(nodeKeys) ||
    !edges ||
    !ts.isIdentifier(edges) ||
    edges.text !== 'expectedEdges' ||
    !expectedEdges ||
    !expectedEdges.initializer ||
    !ts.isArrayLiteralExpression(expectedEdges.initializer)
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
      node.expression?.getText().includes('{ kernel, topologicalOffsets: expectedOrder }'),
  );
  if (
    !buildName ||
    !kernelDeclaration ||
    !isConstDeclaration(kernelDeclaration) ||
    !returnWithKernel
  ) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, call.call);
  }
};

const validateInternalPromotion = (
  modules: readonly ParsedModule[],
  violations: ArchitectureViolation[],
): void => {
  const module = modules.find(
    (entry) => entry.path === 'src/transition/validate-compiled-internally.ts',
  );
  const owner = findFunction(
    modules,
    'src/transition/validate-compiled-internally.ts',
    'validateCompiledInternally',
  );
  if (!module || !owner) {
    add(violations, 'GRAPH_KERNEL_ANALYSIS_UNPROVEN', module);
    return;
  }
  const allCalls = modules.flatMap((entry) =>
    directCalls(entry.sourceFile, 'canonicalCoreGraph').map((call) => ({ entry, call })),
  );
  const ownedCalls = directCalls(owner, 'canonicalCoreGraph');
  const soleOwnedCall = ownedCalls[0];
  if (
    allCalls.length !== 1 ||
    ownedCalls.length !== 1 ||
    soleOwnedCall === undefined ||
    !isDirectTopLevelCall(owner, soleOwnedCall)
  ) {
    add(
      violations,
      allCalls.length > 1 || ownedCalls.length > 1
        ? 'GRAPH_KERNEL_BUILD_REPEAT'
        : 'GRAPH_KERNEL_TRUST_DOMINANCE',
      module,
      ownedCalls[1] ?? ownedCalls[0] ?? owner,
    );
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
  if (directCalls(owner, 'validateCompiledInternally').length !== 1) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, owner);
  }
  if (
    directCalls(owner, 'buildGraphKernel').length > 0 ||
    identifierReferences(owner, 'kernel').length > 0
  ) {
    add(violations, 'GRAPH_KERNEL_ADAPTER_EXPOSURE', module, owner);
  }
  const returns = descendants(owner).filter(ts.isReturnStatement);
  if (
    returns.length !== 1 ||
    !returns[0]?.expression?.getText().includes('{ ok: true, pipeline: validated.pipeline }') ||
    !returns[0]?.expression?.getText().includes('{ ok: false }')
  ) {
    add(violations, 'GRAPH_KERNEL_ADAPTER_EXPOSURE', module, returns[0] ?? owner);
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
  if (
    directCalls(decide, 'validateCompiledInternally').length !== 1 ||
    directCalls(decide, 'evaluationIndex').length !== 1
  ) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, decide);
  }
  const evaluationCall = directCalls(decide, 'evaluationIndex')[0];
  if (
    !evaluationCall ||
    evaluationCall.arguments[1]?.getText() !== 'compiled.kernel' ||
    evaluationCall.arguments[0]?.getText() !== 'compiled.pipeline'
  ) {
    add(violations, 'GRAPH_KERNEL_IDENTITY_FLOW', module, evaluationCall ?? decide);
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
    validateAcceptedFileShapes(modules, violations);
    validateAcceptedOwnerShapes(modules, violations);
    validateTrackedImports(modules, violations);
    const calls = validateBuilderReferences(modules, violations);
    validateBuilderCalls(calls, violations);
    validateCompiler(
      modules,
      calls.find((call) => call.module.path === 'src/definition/compile-pipeline.ts'),
      violations,
    );
    validateInternalValidator(
      modules,
      calls.find((call) => call.module.path === 'src/transition/validate-compiled-internally.ts'),
      violations,
    );
    validateInternalPromotion(modules, violations);
    validateHostileExpectedEdgeWrites(modules, violations);
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
