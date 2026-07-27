import * as ts from 'typescript/unstable/ast';
import {
  type ArrowFunction,
  type CallExpression,
  type Node,
  type SourceFile,
} from 'typescript/unstable/ast';
import { createVirtualFileSystem } from 'typescript/unstable/fs';
import { API, type Checker } from 'typescript/unstable/sync';

export interface ReducerBoundSources {
  readonly assembly: string;
  readonly commandReplay: string;
  readonly drain: string;
  readonly effectDelta: string;
}

const descendants = (root: Node): Node[] => {
  const values: Node[] = [];
  const visit = (node: Node): void => {
    values.push(node);
    node.forEachChild(visit);
  };
  root.forEachChild(visit);
  return values;
};

const functionArrow = (source: SourceFile, name: string): ArrowFunction | undefined =>
  descendants(source).find(
    (node): node is ArrowFunction =>
      ts.isArrowFunction(node) &&
      ts.isVariableDeclaration(node.parent) &&
      ts.isIdentifier(node.parent.name) &&
      node.parent.name.text === name,
  );

const compact = (value: string): string => value.replaceAll(/\s+/g, '');
const exact = (node: Node | undefined, source: string): boolean =>
  node !== undefined && compact(node.getText()) === compact(source);

const hasExactFaultReturn = (
  statement: Node | undefined,
  code: string,
  path: string,
  message: string,
): boolean => {
  if (!statement || !ts.isIfStatement(statement) || !ts.isBlock(statement.thenStatement)) {
    return false;
  }
  const [fault, returned] = statement.thenStatement.statements;
  const call =
    fault && ts.isExpressionStatement(fault) && ts.isCallExpression(fault.expression)
      ? fault.expression
      : undefined;
  return (
    call !== undefined &&
    exact(call.expression, 'faults.add') &&
    call.arguments.length === 3 &&
    exact(call.arguments[0], `'${code}'`) &&
    exact(call.arguments[1], `'${path}'`) &&
    exact(call.arguments[2], `'${message}'`) &&
    returned !== undefined &&
    ts.isReturnStatement(returned) &&
    returned.expression !== undefined
  );
};

const validateDrain = (source: SourceFile): void => {
  const owner = functionArrow(source, 'drainPipeline');
  const statements = owner?.body && ts.isBlock(owner.body) ? owner.body.statements : [];
  const loop = statements[0];
  const loops = owner ? descendants(owner).filter(ts.isWhileStatement) : [];
  if (
    !owner ||
    loops.length !== 1 ||
    !loop ||
    !ts.isWhileStatement(loop) ||
    !exact(loop.expression, 'state.applications < 514') ||
    !ts.isBlock(loop.statement)
  ) {
    throw new Error('[reducer-step-bound] loop');
  }
  const increments = descendants(loop).filter(
    (node) => ts.isBinaryExpression(node) && exact(node, 'state.applications += 1'),
  );
  const incrementStatement = loop.statement.statements.findIndex(
    (statement) =>
      ts.isExpressionStatement(statement) && exact(statement, 'state.applications += 1;'),
  );
  const guard = loop.statement.statements[incrementStatement + 1];
  const terminalReturn = statements.at(-1);
  const checks = [
    ['increment-count', increments.length === 1],
    ['increment-live', incrementStatement >= 0],
    ['guard-present', guard !== undefined && ts.isIfStatement(guard)],
    [
      'guard-expression',
      guard !== undefined &&
        ts.isIfStatement(guard) &&
        exact(guard.expression, 'state.applications > 513'),
    ],
    [
      'guard-fault',
      hasExactFaultReturn(
        guard,
        'REDUCTION_STEP_LIMIT',
        '/reduction/steps',
        'Pipeline reduction step limit exceeded.',
      ),
    ],
    [
      'guard-return',
      guard !== undefined &&
        ts.isIfStatement(guard) &&
        ts.isBlock(guard.thenStatement) &&
        exact(guard.thenStatement.statements[1], 'return undefined;'),
    ],
    [
      'loop-termination',
      terminalReturn !== undefined &&
        ts.isReturnStatement(terminalReturn) &&
        exact(terminalReturn, 'return undefined;'),
    ],
  ] as const;
  const failed = checks.find(([, valid]) => !valid);
  if (failed) {
    throw new Error(`[reducer-step-bound] ${failed[0]}`);
  }
};

const importedSymbol = (source: SourceFile, localName: string): ts.ImportSpecifier | undefined =>
  descendants(source).find(
    (node): node is ts.ImportSpecifier =>
      ts.isImportSpecifier(node) && node.name.text === localName,
  );

const validateAssembly = (source: SourceFile, checker: Checker): void => {
  const owner = functionArrow(source, 'assemblePipelineReduction');
  const statements = owner?.body && ts.isBlock(owner.body) ? owner.body.statements : [];
  const guard = statements[0];
  const calls = owner
    ? descendants(owner).filter(
        (node): node is CallExpression =>
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'validateEffectDelta',
      )
    : [];
  const imported = importedSymbol(source, 'validateEffectDelta');
  const callIdentifier = calls[0]?.expression;
  if (
    !owner ||
    calls.length !== 1 ||
    !imported ||
    !callIdentifier ||
    !ts.isIdentifier(callIdentifier) ||
    checker.getSymbolAtLocation(imported.name) !== checker.getSymbolAtLocation(callIdentifier) ||
    !guard ||
    !ts.isIfStatement(guard) ||
    !exact(guard.expression, '!validateEffectDelta(state, application)') ||
    !hasExactFaultReturn(
      guard,
      'REDUCTION_INVARIANT',
      '/reduction/effects',
      'Effect and state delta disagree.',
    ) ||
    !ts.isBlock(guard.thenStatement) ||
    !exact(guard.thenStatement.statements[1], 'return { ok: false, faults: faults.finish() };')
  ) {
    throw new Error('[reducer-effect-bound]');
  }
};

const validateEffectGuard = (source: SourceFile): void => {
  const owner = functionArrow(source, 'validateEffectDelta');
  const statements = owner?.body && ts.isBlock(owner.body) ? owner.body.statements : [];
  const guard = statements[0];
  const arms = [
    'initialize',
    'completeTask',
    'recordConsensusVerdict',
    'resolveHumanGate',
    'completeSelector',
    'activateNode',
    'terminatePipeline',
  ];
  if (
    !owner ||
    !guard ||
    !ts.isIfStatement(guard) ||
    !exact(
      guard.expression,
      "state.effects.length > 514 || (application === 'unchanged' && state.effects.length !== 0)",
    ) ||
    !exact(guard.thenStatement, '{ return false; }') ||
    !arms.every((kind) =>
      descendants(source).some(
        (node) => ts.isBinaryExpression(node) && exact(node, `effect.kind === '${kind}'`),
      ),
    ) ||
    !descendants(owner).some(
      (node) =>
        ts.isReturnStatement(node) &&
        exact(node.expression, 'comparable(shadow) === comparable(state)'),
    )
  ) {
    throw new Error('[reducer-effect-bound]');
  }
};

const validateProspectiveValueGuard = (source: SourceFile): void => {
  const owner = functionArrow(source, 'classifyCommandReplay');
  const statements = owner?.body && ts.isBlock(owner.body) ? owner.body.statements : [];
  const ownership = statements.findIndex(
    (statement) =>
      ts.isIfStatement(statement) &&
      exact(statement.expression, 'values.some((fact) => ownedKeys.has(fact.key))'),
  );
  const sameReplay = statements.findIndex(
    (statement) => ts.isIfStatement(statement) && exact(statement.expression, "replay === 'same'"),
  );
  const conflictReplay = statements.findIndex(
    (statement) =>
      ts.isIfStatement(statement) && exact(statement.expression, "replay === 'different'"),
  );
  const lifecycle = statements.findIndex(
    (statement) =>
      ts.isIfStatement(statement) && exact(statement.expression, "node?.state !== 'enabled'"),
  );
  const limit = statements[ownership + 1];
  if (
    !owner ||
    sameReplay < 0 ||
    conflictReplay <= sameReplay ||
    lifecycle <= conflictReplay ||
    ownership <= lifecycle ||
    !hasExactFaultReturn(
      statements[lifecycle],
      'COMMAND_STATE',
      '/command/occurrence',
      'Command target is not enabled.',
    ) ||
    ownership < 0 ||
    !hasExactFaultReturn(
      statements[ownership],
      'COMMAND_CONFLICT',
      '/command/values',
      'Command value is already source-owned.',
    ) ||
    !limit ||
    !ts.isIfStatement(limit) ||
    !exact(limit.expression, 'snapshot.values.length + values.length > 128') ||
    !hasExactFaultReturn(
      limit,
      'COMMAND_LIMIT',
      '/command/values',
      'Resulting snapshot value limit exceeded.',
    )
  ) {
    throw new Error('[reducer-command-value-bound]');
  }
};

export const validateReducerBounds = (sources: ReducerBoundSources): void => {
  const root = '/reducer-proof';
  const paths = {
    assembly: `${root}/src/transition/reduction/assemble-pipeline-reduction.ts`,
    commandReplay: `${root}/src/transition/command/classify-command-replay.ts`,
    drain: `${root}/src/transition/reduction/drain-pipeline.ts`,
    effectDelta: `${root}/src/transition/reduction/validate-effect-delta.ts`,
  };
  const config = `${root}/tsconfig.json`;
  const files = {
    [config]: JSON.stringify({
      compilerOptions: { noLib: true, noResolve: true },
      files: Object.values(paths),
    }),
    [paths.assembly]: sources.assembly,
    [paths.commandReplay]: sources.commandReplay,
    [paths.drain]: sources.drain,
    [paths.effectDelta]: sources.effectDelta,
  };
  const api = new API({ cwd: root, fs: createVirtualFileSystem(files) });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    const project = snapshot.getProjects()[0];
    const assembly = project?.program.getSourceFile(paths.assembly);
    const commandReplay = project?.program.getSourceFile(paths.commandReplay);
    const drain = project?.program.getSourceFile(paths.drain);
    const effect = project?.program.getSourceFile(paths.effectDelta);
    const syntactic = project?.program.getSyntacticDiagnostics() ?? [];
    if (!project || !assembly || !commandReplay || !drain || !effect || syntactic.length) {
      throw new Error('[reducer-analysis-unproven]');
    }
    validateDrain(drain);
    validateAssembly(assembly, project.checker);
    validateEffectGuard(effect);
    validateProspectiveValueGuard(commandReplay);
  } finally {
    void api;
  }
};
