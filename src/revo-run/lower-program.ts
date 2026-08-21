import { compareUnicodeCodePoints, isIdentifier, type JsonPointer } from '../foundation/index.js';
import type {
  PipelineProgram,
  ProgramChoiceNode,
  ProgramDigestInput,
  ProgramEndNode,
  ProgramNode,
  ProgramValueSelector,
} from '../program/index.js';
import type {
  PipelineExecutionNode,
  PipelineExecutionPlan,
  PipelineExecutionPlanOptions,
} from './contracts.js';
import {
  executionPlanDiagnostic,
  finalizeExecutionPlanDiagnostics,
  type ExecutionPlanDiagnostic,
} from './diagnostics.js';
import { choiceIdentity, pipelineIdentity } from './identity.js';
import { lowerExecutionOutput, lowerExecutionSelector } from './selectors.js';

export type ExecutionPlanLoweringResult =
  | { readonly ok: true; readonly executionPlan: PipelineExecutionPlan }
  | { readonly ok: false; readonly diagnostics: readonly ExecutionPlanDiagnostic[] };

const policyIsValid = (options: PipelineExecutionPlanOptions): boolean =>
  Object.values(options.policies).every((value) => Number.isSafeInteger(value) && value > 0);

const sourcePaths = (bundle: ProgramDigestInput): ReadonlyMap<string, JsonPointer> =>
  new Map(
    bundle.provenance.nodes.map(({ programNodeId, sourcePath }) => [programNodeId, sourcePath]),
  );

const pathFor = (paths: ReadonlyMap<string, JsonPointer>, nodeId: string): JsonPointer =>
  paths.get(nodeId) ?? '';

const collectUnsupportedNodes = (
  program: PipelineProgram,
  paths: ReadonlyMap<string, JsonPointer>,
): readonly ExecutionPlanDiagnostic[] =>
  program.modules.flatMap(({ region }) =>
    region.nodes
      .filter((node) => node.kind !== 'choice' && node.kind !== 'end')
      .map((node) =>
        executionPlanDiagnostic('EXECUTION_PLAN_NODE_UNSUPPORTED', pathFor(paths, node.id)),
      ),
  );

const validateGraph = (
  nodes: ReadonlyMap<string, ProgramNode>,
  entry: string,
  paths: ReadonlyMap<string, JsonPointer>,
): readonly ExecutionPlanDiagnostic[] => {
  const inbound = new Map<string, number>();
  const diagnostics: ExecutionPlanDiagnostic[] = [];
  const active = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    const node = nodes.get(nodeId);
    if (node === undefined) {
      diagnostics.push(executionPlanDiagnostic('EXECUTION_PLAN_GRAPH_UNSUPPORTED', ''));
      return;
    }
    if (active.has(nodeId) || visited.has(nodeId)) {
      diagnostics.push(
        executionPlanDiagnostic('EXECUTION_PLAN_GRAPH_UNSUPPORTED', pathFor(paths, nodeId)),
      );
      return;
    }
    active.add(nodeId);
    if (node.kind === 'choice') {
      const targets = [
        ...node.cases.map(({ target }) => target),
        ...(node.otherwise === null ? [] : [node.otherwise]),
      ];
      for (const target of targets) {
        inbound.set(target, (inbound.get(target) ?? 0) + 1);
        if ((inbound.get(target) ?? 0) > 1) {
          diagnostics.push(
            executionPlanDiagnostic('EXECUTION_PLAN_GRAPH_UNSUPPORTED', pathFor(paths, target)),
          );
        }
        visit(target);
      }
    }
    active.delete(nodeId);
    visited.add(nodeId);
  };
  visit(entry);
  return diagnostics;
};

const stringChoiceValues = (node: ProgramChoiceNode): readonly string[] | null => {
  const values = node.cases.flatMap(({ when }) =>
    when.kind === 'equals' ? [when.value] : when.values,
  );
  if (!values.every((value): value is string => typeof value === 'string' && isIdentifier(value))) {
    return null;
  }
  return values;
};

const choiceSelector = (selector: ProgramValueSelector) => lowerExecutionSelector(selector);

type NodeLoweringResult =
  | { readonly ok: true; readonly node: PipelineExecutionNode }
  | { readonly ok: false; readonly diagnostics: readonly ExecutionPlanDiagnostic[] };

const lowerNode = (
  nodeId: string,
  nodes: ReadonlyMap<string, ProgramNode>,
  paths: ReadonlyMap<string, JsonPointer>,
  depth: number,
  maximumDepth: number,
): NodeLoweringResult => {
  const node = nodes.get(nodeId);
  if (node === undefined) {
    return {
      ok: false,
      diagnostics: [executionPlanDiagnostic('EXECUTION_PLAN_GRAPH_UNSUPPORTED', '')],
    };
  }
  if (depth > maximumDepth) {
    return {
      ok: false,
      diagnostics: [
        executionPlanDiagnostic('EXECUTION_PLAN_DEPTH_EXCEEDED', pathFor(paths, node.id)),
      ],
    };
  }
  if (node.kind === 'end') {
    return lowerEnd(node, paths);
  }
  if (node.kind !== 'choice') {
    return {
      ok: false,
      diagnostics: [
        executionPlanDiagnostic('EXECUTION_PLAN_NODE_UNSUPPORTED', pathFor(paths, node.id)),
      ],
    };
  }
  return lowerChoice(node, nodes, paths, depth, maximumDepth);
};

const lowerEnd = (
  node: ProgramEndNode,
  paths: ReadonlyMap<string, JsonPointer>,
): NodeLoweringResult => {
  if (!isIdentifier(node.outcome)) {
    return {
      ok: false,
      diagnostics: [
        executionPlanDiagnostic('EXECUTION_PLAN_OUTCOME_UNSUPPORTED', pathFor(paths, node.id)),
      ],
    };
  }
  const output = lowerExecutionOutput(node.output);
  if (output === null) {
    const hasInvalidKey = Object.keys(node.output).some((key) => !isIdentifier(key));
    return {
      ok: false,
      diagnostics: [
        executionPlanDiagnostic(
          hasInvalidKey
            ? 'EXECUTION_PLAN_OUTPUT_KEY_UNSUPPORTED'
            : 'EXECUTION_PLAN_SELECTOR_UNSUPPORTED',
          pathFor(paths, node.id),
        ),
      ],
    };
  }
  return Object.freeze({
    ok: true,
    node: Object.freeze({ kind: 'end', status: 'succeeded', outcome: node.outcome, output }),
  });
};

const lowerChoice = (
  node: ProgramChoiceNode,
  nodes: ReadonlyMap<string, ProgramNode>,
  paths: ReadonlyMap<string, JsonPointer>,
  depth: number,
  maximumDepth: number,
): NodeLoweringResult => {
  const key = choiceIdentity(node.id);
  if (key === null) {
    return {
      ok: false,
      diagnostics: [
        executionPlanDiagnostic('EXECUTION_PLAN_IDENTITY_INVALID', pathFor(paths, node.id)),
      ],
    };
  }
  if (node.otherwise === null) {
    return {
      ok: false,
      diagnostics: [
        executionPlanDiagnostic('EXECUTION_PLAN_CHOICE_DEFAULT_REQUIRED', pathFor(paths, node.id)),
      ],
    };
  }
  if (stringChoiceValues(node) === null) {
    return {
      ok: false,
      diagnostics: [
        executionPlanDiagnostic('EXECUTION_PLAN_CHOICE_VALUE_UNSUPPORTED', pathFor(paths, node.id)),
      ],
    };
  }
  const selector = choiceSelector(node.selector);
  if (selector === null) {
    return {
      ok: false,
      diagnostics: [
        executionPlanDiagnostic('EXECUTION_PLAN_SELECTOR_UNSUPPORTED', pathFor(paths, node.id)),
      ],
    };
  }
  const cases: Record<string, PipelineExecutionNode> = {};
  for (const entry of node.cases) {
    const lowered = lowerNode(entry.target, nodes, paths, depth + 1, maximumDepth);
    if (!lowered.ok) {
      return lowered;
    }
    const values = entry.when.kind === 'equals' ? [entry.when.value] : entry.when.values;
    for (const value of values) {
      if (typeof value === 'string') {
        cases[value] = lowered.node;
      }
    }
  }
  const fallback = lowerNode(node.otherwise, nodes, paths, depth + 1, maximumDepth);
  if (!fallback.ok) {
    return fallback;
  }
  return Object.freeze({
    ok: true,
    node: Object.freeze({
      kind: 'choice',
      key,
      selector,
      cases: Object.freeze(
        Object.fromEntries(
          Object.entries(cases).toSorted(([left], [right]) =>
            compareUnicodeCodePoints(left, right),
          ),
        ),
      ),
      default: fallback.node,
    }),
  });
};

export const lowerToExecutionPlan = (
  bundle: ProgramDigestInput,
  options: PipelineExecutionPlanOptions,
): ExecutionPlanLoweringResult => {
  const diagnostics: ExecutionPlanDiagnostic[] = [];
  if (!policyIsValid(options)) {
    diagnostics.push(executionPlanDiagnostic('EXECUTION_PLAN_CONTRACT_INVALID', ''));
  }
  if (options.bindings.length > 0) {
    diagnostics.push(executionPlanDiagnostic('EXECUTION_PLAN_BINDINGS_UNSUPPORTED', ''));
  }
  const { program } = bundle;
  if (program.modules.length !== 1 || program.modules[0]?.key !== program.entryModule) {
    diagnostics.push(executionPlanDiagnostic('EXECUTION_PLAN_MODULES_UNSUPPORTED', ''));
  }
  const module = program.modules[0];
  if (module === undefined) {
    return { ok: false, diagnostics: finalizeExecutionPlanDiagnostics(diagnostics) };
  }
  const paths = sourcePaths(bundle);
  diagnostics.push(...collectUnsupportedNodes(program, paths));
  const nodes = new Map(module.region.nodes.map((node) => [node.id, node]));
  diagnostics.push(...validateGraph(nodes, module.region.entry, paths));
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: finalizeExecutionPlanDiagnostics(diagnostics) };
  }
  const pipelineId = pipelineIdentity(module.region.id);
  if (pipelineId === null) {
    return {
      ok: false,
      diagnostics: [executionPlanDiagnostic('EXECUTION_PLAN_IDENTITY_INVALID', '')],
    };
  }
  const lowered = lowerNode(
    module.region.entry,
    nodes,
    paths,
    1,
    options.policies.maximumNodeNestingDepth,
  );
  if (!lowered.ok) {
    return { ok: false, diagnostics: finalizeExecutionPlanDiagnostics(lowered.diagnostics) };
  }
  return {
    ok: true,
    executionPlan: Object.freeze({
      schemaVersion: 'pipeline-execution-plan/v1',
      rootPipelineId: pipelineId,
      pipelines: Object.freeze({ [pipelineId]: Object.freeze({ root: lowered.node }) }),
      bindings: [] as const,
      policies: Object.freeze({ ...options.policies }),
    }),
  };
};
