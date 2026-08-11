import {
  PIPELINE_LIMITS,
  appendJsonPointer,
  compareUnicodeCodePoints,
  type DiagnosticCollector,
  type JsonPointer,
} from '../../foundation/index.js';
import {
  EmptyObjectSchema,
  type AgentSourceNode,
  type PipelineSourcePackage,
  type SourceNode,
  type SourceRegion,
} from '../contracts/index.js';
import { nestedPath } from '../internal.js';
import { valueSchemasEqual } from '../value-schema/index.js';
import { analyzeRegionGraph } from './region-graph.js';
import {
  bodyEnvironment,
  nodeSelectorGroups,
  validateChoice,
  validateSelectors,
  type SelectorEnvironment,
} from './selector-resolution.js';
import { validateExitClassifications, validateGateBijection } from './structured-semantics.js';

export type ReachableAgentSlot = {
  readonly sourcePath: JsonPointer;
  readonly slotKey: string;
  readonly strategies: AgentSourceNode['strategies'];
};

type SourceRegistry = {
  readonly agents: ReachableAgentSlot[];
  nodeCount: number;
  targetCount: number;
};

const validateRegionGraph = (
  region: SourceRegion,
  path: JsonPointer,
  collector: DiagnosticCollector,
  registry: SourceRegistry,
): ReadonlySet<string> => {
  const analysis = analyzeRegionGraph(region, path);
  registry.targetCount += analysis.targetCount;
  if (analysis.entryMissing) {
    collector.add('CANONICAL_INPUT', appendJsonPointer(path, 'entry'));
    return analysis.reachable;
  }
  for (const invalidTargetPath of analysis.invalidTargetPaths) {
    collector.add('CANONICAL_INPUT', invalidTargetPath);
  }
  if (analysis.unreachablePath !== undefined) {
    collector.add('CANONICAL_INPUT', analysis.unreachablePath);
  }
  if (analysis.cyclicPath !== undefined) {
    collector.add('CANONICAL_INPUT', analysis.cyclicPath);
  }
  if (analysis.nonExitingPath !== undefined) {
    collector.add('CANONICAL_INPUT', analysis.nonExitingPath);
  }
  return analysis.reachable;
};

const validateNestedRegions = (
  node: SourceNode,
  path: JsonPointer,
  environment: SelectorEnvironment,
  collector: DiagnosticCollector,
  registry: SourceRegistry,
): void => {
  if (node.kind === 'parallel') {
    for (const [index, branch] of node.branches.entries()) {
      const branchPath = nestedPath(path, 'branches', String(index));
      validateExitClassifications(
        branch.region,
        branch.exits,
        appendJsonPointer(branchPath, 'region'),
        appendJsonPointer(branchPath, 'exits'),
        collector,
      );
      validateRegionSemantics(
        branch.region,
        appendJsonPointer(branchPath, 'region'),
        bodyEnvironment(environment, node, collector, path),
        collector,
        registry,
      );
    }
  } else if (node.kind === 'repeat' || node.kind === 'map') {
    const childPath = appendJsonPointer(path, 'body');
    validateExitClassifications(
      node.body,
      node.bodyExits,
      childPath,
      appendJsonPointer(path, 'bodyExits'),
      collector,
    );
    validateRegionSemantics(
      node.body,
      childPath,
      bodyEnvironment(environment, node, collector, path),
      collector,
      registry,
    );
  }
};

const validateNodeSemantics = (
  node: SourceNode,
  path: JsonPointer,
  environment: SelectorEnvironment,
  collector: DiagnosticCollector,
  registry: SourceRegistry,
): void => {
  if (node.kind === 'choice') {
    validateChoice(node, path, environment, collector);
  }
  if (node.kind === 'humanGate') {
    validateGateBijection(node, path, collector);
  }
  for (const [selectors, timing] of nodeSelectorGroups(node, path)) {
    const scoped =
      timing === 'child-exit' && (node.kind === 'repeat' || node.kind === 'map')
        ? {
            ...bodyEnvironment(environment, node, collector, path),
            regionOutput: node.body.outputSchema,
          }
        : bodyEnvironment(environment, node, collector, path);
    validateSelectors(selectors, scoped, collector);
  }
  validateNestedRegions(node, path, environment, collector, registry);
};

const validateRegionSemantics = (
  region: SourceRegion,
  path: JsonPointer,
  inherited: SelectorEnvironment,
  collector: DiagnosticCollector,
  registry: SourceRegistry,
): void => {
  registry.nodeCount += region.nodes.length;
  const reachable = validateRegionGraph(region, path, collector, registry);
  const environment: SelectorEnvironment = {
    ...inherited,
    scopeInput: region.inputSchema ?? EmptyObjectSchema,
    nodes: new Map(region.nodes.map((node) => [node.key, node])),
  };
  for (const [index, node] of region.nodes.entries()) {
    const nodePath = nestedPath(path, 'nodes', String(index));
    if (node.kind === 'end' && !region.exits.some(({ outcome }) => outcome === node.outcome)) {
      collector.add('CANONICAL_INPUT', appendJsonPointer(nodePath, 'outcome'));
    }
    validateNodeSemantics(node, nodePath, environment, collector, registry);
    if (node.kind === 'agent' && reachable.has(node.key)) {
      registry.agents.push(
        Object.freeze({ sourcePath: nodePath, slotKey: node.slotKey, strategies: node.strategies }),
      );
    }
  }
};

export const validateSourceSemantics = (
  source: PipelineSourcePackage,
  collector: DiagnosticCollector,
): readonly ReachableAgentSlot[] => {
  const registry: SourceRegistry = { agents: [], nodeCount: 0, targetCount: 0 };
  if (!source.modules.some(({ key }) => key === source.entryModule)) {
    collector.add('CANONICAL_INPUT', '/entryModule');
  }
  for (const [index, module] of source.modules.entries()) {
    const modulePath = nestedPath('/modules', String(index));
    if (!valueSchemasEqual(module.inputSchema, module.region.inputSchema ?? EmptyObjectSchema)) {
      collector.add('CANONICAL_INPUT', nestedPath(modulePath, 'region', 'inputSchema'));
    }
    if (!valueSchemasEqual(module.outputSchema, module.region.outputSchema)) {
      collector.add('CANONICAL_INPUT', nestedPath(modulePath, 'region', 'outputSchema'));
    }
    validateRegionSemantics(
      module.region,
      appendJsonPointer(modulePath, 'region'),
      { moduleInput: module.inputSchema, scopeInput: module.inputSchema, nodes: new Map() },
      collector,
      registry,
    );
  }
  if (registry.nodeCount > PIPELINE_LIMITS.sourcePackage.nodes) {
    collector.add('BOUND_EXCEEDED', '/modules');
  }
  if (registry.targetCount > PIPELINE_LIMITS.sourcePackage.targets) {
    collector.add('BOUND_EXCEEDED', '/modules');
  }
  return Object.freeze(
    registry.agents.sort((left, right) =>
      compareUnicodeCodePoints(left.sourcePath, right.sourcePath),
    ),
  );
};
