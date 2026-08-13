import { Compile } from 'typebox/compile';

import {
  PIPELINE_LIMITS,
  normalizeOwnedEnvelope,
  normalizePortableValue,
  valueSchemasEqual,
  type JsonValue,
} from '../../foundation/index.js';
import {
  analyzeProgram,
  type ProgramModule,
  type ProgramNode,
  type ProgramRegion,
} from '../../program/index.js';
import { KernelProgramSchema, type KernelProgram } from '../contracts/program.js';
import { hasValidCallGraph, type ModuleCallEdge } from './module-graph.js';
import { isStrictlySorted, sameOrderedKeys } from './ordering.js';
import { childRegions, hasValidRegionGraph, localTargets } from './region-graph.js';
import {
  hasValidStructuredSemantics,
  type StructuredValidationCounters,
} from './structured-validation.js';

const kernelProgramValidator = Compile(KernelProgramSchema);

export type ProgramIndex = {
  readonly bundle: KernelProgram;
  readonly modules: ReadonlyMap<string, ProgramModule>;
  readonly regions: ReadonlyMap<string, ProgramRegion>;
};

export type ProgramInspection =
  | { readonly ok: true; readonly index: ProgramIndex }
  | { readonly ok: false };

export type ProgramValidationCounters = StructuredValidationCounters & {
  admissionAnalyses: number;
  modules: number;
  regions: number;
  nodes: number;
  targets: number;
};

type RegionTask = {
  readonly moduleKey: string;
  readonly region: ProgramRegion;
  readonly depth: number;
};

type MutableIndex = {
  readonly modules: Map<string, ProgramModule>;
  readonly regions: Map<string, ProgramRegion>;
  readonly nodeIds: Set<string>;
  readonly calls: ModuleCallEdge[];
  nodeCount: number;
  targetCount: number;
};

const callMatchesModule = (
  node: Extract<ProgramNode, { readonly kind: 'call' }>,
  modules: ReadonlyMap<string, ProgramModule>,
): boolean => {
  const target = modules.get(node.module);
  return (
    target !== undefined &&
    valueSchemasEqual(node.outputSchema, target.outputSchema) &&
    sameOrderedKeys(
      node.routes.outcomes,
      target.region.exits,
      ({ outcome }) => outcome,
      ({ outcome }) => outcome,
    )
  );
};

const hasValidNodeSemantics = (
  node: ProgramNode,
  region: ProgramRegion,
  modules: ReadonlyMap<string, ProgramModule>,
  counters?: ProgramValidationCounters,
): boolean =>
  hasValidStructuredSemantics(node, counters) &&
  (node.kind !== 'end' || region.exits.some(({ outcome }) => outcome === node.outcome)) &&
  (node.kind !== 'call' || callMatchesModule(node, modules));

const indexNode = (
  node: ProgramNode,
  task: RegionTask,
  index: MutableIndex,
  pending: RegionTask[],
  counters?: ProgramValidationCounters,
): boolean => {
  if (
    index.nodeIds.has(node.id) ||
    !hasValidNodeSemantics(node, task.region, index.modules, counters)
  ) {
    return false;
  }
  index.nodeIds.add(node.id);
  const targets = localTargets(node);
  index.targetCount += targets.length;
  if (counters !== undefined) {
    counters.nodes += 1;
    counters.targets += targets.length;
  }
  if (node.kind === 'call') {
    index.calls.push(Object.freeze({ from: task.moduleKey, to: node.module }));
  }
  for (const child of childRegions(node)) {
    pending.push(
      Object.freeze({ moduleKey: task.moduleKey, region: child, depth: task.depth + 1 }),
    );
  }
  return true;
};

const indexRegion = (
  task: RegionTask,
  index: MutableIndex,
  pending: RegionTask[],
  counters?: ProgramValidationCounters,
): boolean => {
  const { region } = task;
  if (
    task.depth > PIPELINE_LIMITS.sourcePackage.nestingDepth ||
    index.regions.has(region.id) ||
    !isStrictlySorted(region.nodes, ({ id }) => id) ||
    !isStrictlySorted(region.exits, ({ outcome }) => outcome) ||
    !hasValidRegionGraph(region)
  ) {
    return false;
  }
  index.regions.set(region.id, region);
  index.nodeCount += region.nodes.length;
  if (counters !== undefined) {
    counters.regions += 1;
  }
  return (
    index.nodeCount <= PIPELINE_LIMITS.sourcePackage.nodes &&
    region.nodes.every((node) => indexNode(node, task, index, pending, counters)) &&
    index.targetCount <= PIPELINE_LIMITS.sourcePackage.targets
  );
};

const buildModuleIndex = (
  bundle: KernelProgram,
  counters?: ProgramValidationCounters,
): Map<string, ProgramModule> | null => {
  const modules = bundle.program.modules;
  if (!isStrictlySorted(modules, ({ key }) => key)) {
    return null;
  }
  const index = new Map<string, ProgramModule>();
  for (const module of modules) {
    if (
      index.has(module.key) ||
      !valueSchemasEqual(module.inputSchema, module.region.inputSchema) ||
      !valueSchemasEqual(module.outputSchema, module.region.outputSchema)
    ) {
      return null;
    }
    index.set(module.key, module);
    if (counters !== undefined) {
      counters.modules += 1;
    }
  }
  return index.has(bundle.program.entryModule) ? index : null;
};

const buildProgramIndex = (
  bundle: KernelProgram,
  counters?: ProgramValidationCounters,
): ProgramIndex | null => {
  const modules = buildModuleIndex(bundle, counters);
  if (modules === null) {
    return null;
  }
  const mutable: MutableIndex = {
    modules,
    regions: new Map(),
    nodeIds: new Set(),
    calls: [],
    nodeCount: 0,
    targetCount: 0,
  };
  const pending = [...modules].map(([moduleKey, module]) =>
    Object.freeze({ moduleKey, region: module.region, depth: 0 }),
  );
  while (pending.length > 0) {
    const task = pending.pop();
    if (task === undefined || !indexRegion(task, mutable, pending, counters)) {
      return null;
    }
  }
  return hasValidCallGraph(modules, mutable.calls)
    ? Object.freeze({ bundle, modules, regions: mutable.regions })
    : null;
};

export const inspectKernelProgram = (
  input: unknown,
  counters?: ProgramValidationCounters,
): ProgramInspection => {
  const owned = normalizeOwnedEnvelope(
    input,
    PIPELINE_LIMITS.machine.liveFrames,
    undefined,
    PIPELINE_LIMITS.machine.serializedStateJsonValues,
  );
  if (!owned.ok || !kernelProgramValidator.Check(owned.value)) {
    return Object.freeze({ ok: false });
  }
  const index = buildProgramIndex(owned.value, counters);
  if (counters !== undefined && index !== null) {
    counters.admissionAnalyses += 1;
  }
  if (index === null || !analyzeProgram(index.bundle.program).ok) {
    return Object.freeze({ ok: false });
  }
  return Object.freeze({ ok: true, index });
};

export const normalizeKernelInput = (input: unknown): JsonValue | null => {
  const owned = normalizePortableValue(input);
  return owned.ok ? owned.value : null;
};
