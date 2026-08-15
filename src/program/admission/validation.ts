import { Compile } from 'typebox/compile';

import {
  PIPELINE_LIMITS,
  normalizeOwnedEnvelope,
  valueSchemaIsCompatible,
  valueSchemasEqual,
} from '../../foundation/index.js';
import {
  analyzeMeasuredProgram,
  firstProgramStructureViolation,
  measureProgramModuleGraph,
  measureProgramStructure,
} from '../analysis/index.js';
import {
  PipelineProgramSchema,
  type PipelineProgram,
  type ProgramModule,
  type ProgramNode,
  type ProgramRegion,
} from '../contracts/index.js';
import { hasValidProgramDataflow } from './dataflow.js';
import {
  childRegions,
  hasValidCallGraph,
  hasValidRegionGraph,
  localTargets,
  type ModuleCallEdge,
} from './graphs.js';
import { isStrictlySorted, sameOrderedKeys } from './ordering.js';
import { hasValidStructuredSemantics, type StructuredValidationCounters } from './structured.js';

const programValidator = Compile(PipelineProgramSchema);

export type ProgramIndex = {
  readonly program: PipelineProgram;
  readonly modules: ReadonlyMap<string, ProgramModule>;
  readonly regions: ReadonlyMap<string, ProgramRegion>;
};

export type ProgramAdmissionReceipt = {
  readonly program: PipelineProgram;
  readonly index: ProgramIndex;
  readonly analysis: import('../analysis/index.js').ProgramAnalysis;
};

export type OwnedProgramAdmission =
  | { readonly ok: true; readonly receipt: ProgramAdmissionReceipt }
  | { readonly ok: false; readonly reason: 'invalid' }
  | {
      readonly ok: false;
      readonly reason: 'bounds';
      readonly structure: import('../analysis/index.js').ProgramStructureMeasure;
      readonly violation: import('../analysis/index.js').ProgramAdmissionViolation;
    };

export type ProgramInspection =
  | { readonly ok: true; readonly index: ProgramIndex; readonly receipt: ProgramAdmissionReceipt }
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

const indexNode = (
  node: ProgramNode,
  task: RegionTask,
  index: MutableIndex,
  pending: RegionTask[],
  counters?: ProgramValidationCounters,
): boolean => {
  if (
    index.nodeIds.has(node.id) ||
    index.regions.has(node.id) ||
    !hasValidStructuredSemantics(node, counters) ||
    (node.kind === 'end' && !task.region.exits.some(({ outcome }) => outcome === node.outcome)) ||
    (node.kind === 'call' && !callMatchesModule(node, index.modules))
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
    index.regions.has(region.id) ||
    index.nodeIds.has(region.id) ||
    !isStrictlySorted(region.nodes, ({ id }) => id) ||
    !isStrictlySorted(region.exits, ({ outcome }) => outcome) ||
    !region.exits.every(({ outputSchema }) =>
      valueSchemaIsCompatible(outputSchema, region.outputSchema),
    ) ||
    !hasValidRegionGraph(region)
  ) {
    return false;
  }
  index.regions.set(region.id, region);
  index.nodeCount += region.nodes.length;
  if (counters !== undefined) {
    counters.regions += 1;
  }
  return region.nodes.every((node) => indexNode(node, task, index, pending, counters));
};

const buildProgramIndex = (
  program: PipelineProgram,
  counters?: ProgramValidationCounters,
): ProgramIndex | null => {
  if (!isStrictlySorted(program.modules, ({ key }) => key)) {
    return null;
  }
  const modules = new Map<string, ProgramModule>();
  for (const module of program.modules) {
    if (
      modules.has(module.key) ||
      !valueSchemasEqual(module.inputSchema, module.region.inputSchema) ||
      !valueSchemasEqual(module.outputSchema, module.region.outputSchema)
    ) {
      return null;
    }
    modules.set(module.key, module);
    if (counters !== undefined) {
      counters.modules += 1;
    }
  }
  if (!modules.has(program.entryModule)) {
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
    ? Object.freeze({ program, modules, regions: mutable.regions })
    : null;
};

export const admitSchemaValidatedPipelineProgram = (
  program: PipelineProgram,
  counters?: ProgramValidationCounters,
): OwnedProgramAdmission => {
  const moduleGraph = measureProgramModuleGraph(program);
  const structure = measureProgramStructure(program, moduleGraph);
  const structuralViolation = firstProgramStructureViolation(structure);
  if (structuralViolation !== null) {
    return Object.freeze({
      ok: false,
      reason: 'bounds',
      structure,
      violation: structuralViolation,
    });
  }
  const index = buildProgramIndex(program, counters);
  if (index === null || !hasValidProgramDataflow(index.modules)) {
    return Object.freeze({ ok: false, reason: 'invalid' });
  }
  if (counters !== undefined) {
    counters.admissionAnalyses += 1;
  }
  const analyzed = analyzeMeasuredProgram(program, moduleGraph, structure);
  if (!analyzed.ok) {
    return Object.freeze({
      ok: false,
      reason: 'bounds',
      structure: analyzed.analysis.structure,
      violation: analyzed.violation,
    });
  }
  return Object.freeze({
    ok: true,
    receipt: Object.freeze({ program, index, analysis: analyzed.analysis }),
  });
};

export const admitOwnedPipelineProgram = (
  program: PipelineProgram,
  counters?: ProgramValidationCounters,
): OwnedProgramAdmission =>
  programValidator.Check(program)
    ? admitSchemaValidatedPipelineProgram(program, counters)
    : Object.freeze({ ok: false, reason: 'invalid' });

export const inspectOwnedPipelineProgram = (
  program: PipelineProgram,
  counters?: ProgramValidationCounters,
): ProgramInspection => {
  const admitted = admitOwnedPipelineProgram(program, counters);
  return admitted.ok
    ? Object.freeze({ ok: true, index: admitted.receipt.index, receipt: admitted.receipt })
    : Object.freeze({ ok: false });
};

export const inspectPipelineProgram = (
  input: unknown,
  counters?: ProgramValidationCounters,
): ProgramInspection => {
  const owned = normalizeOwnedEnvelope(
    input,
    PIPELINE_LIMITS.machine.liveFrames,
    undefined,
    PIPELINE_LIMITS.machine.serializedStateJsonValues,
  );
  if (!owned.ok || !programValidator.Check(owned.value)) {
    return Object.freeze({ ok: false });
  }
  const admitted = admitSchemaValidatedPipelineProgram(owned.value, counters);
  return admitted.ok
    ? Object.freeze({ ok: true, index: admitted.receipt.index, receipt: admitted.receipt })
    : Object.freeze({ ok: false });
};
