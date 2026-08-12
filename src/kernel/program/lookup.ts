import { compareUnicodeCodePoints, type Digest } from '../../foundation/index.js';
import type {
  ProgramModule,
  ProgramNode,
  ProgramRegion,
  ProgramRegionExit,
} from '../../program/index.js';
import type { MachineFrame } from '../contracts/frames.js';
import type { KernelProgram } from '../contracts/program.js';
import type { RegionMachineFrame, RootRegionMachineFrame } from '../contracts/region-frames.js';
import type { PipelineState } from '../contracts/state.js';

export type LookupCounters = { comparisons: number; ancestrySteps: number };

const recordComparison = (counters?: LookupCounters): void => {
  if (counters !== undefined) {
    counters.comparisons += 1;
  }
};

const binaryFind = <Value>(
  values: readonly Value[],
  target: string,
  key: (value: Value) => string,
  counters?: LookupCounters,
): Value | null => {
  let lower = 0;
  let upper = values.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const value = values[middle];
    if (value === undefined) {
      return null;
    }
    recordComparison(counters);
    const order = compareUnicodeCodePoints(key(value), target);
    if (order === 0) {
      return value;
    }
    if (order < 0) {
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return null;
};

export const findModule = (
  bundle: KernelProgram,
  key: string,
  counters?: LookupCounters,
): ProgramModule | null =>
  binaryFind(bundle.program.modules, key, (module) => module.key, counters);

export const findNode = (
  region: ProgramRegion,
  id: string,
  counters?: LookupCounters,
): ProgramNode | null => binaryFind(region.nodes, id, (node) => node.id, counters);

export const findExit = (
  region: ProgramRegion,
  outcome: string,
  counters?: LookupCounters,
): ProgramRegionExit | null => binaryFind(region.exits, outcome, (exit) => exit.outcome, counters);

export const findFrame = (
  state: PipelineState,
  key: Digest,
  counters?: LookupCounters,
): MachineFrame | null => binaryFind(state.frames, key, (frame) => frame.key, counters);

export type RegionContext = {
  readonly frame: RegionMachineFrame;
  readonly module: ProgramModule;
  readonly region: ProgramRegion;
  readonly moduleInput: RegionMachineFrame['scopeInput'];
  readonly moduleAncestry: readonly [string, ...string[]];
};

const isRegionFrame = (frame: MachineFrame): frame is RegionMachineFrame =>
  frame.kind === 'rootRegion' || frame.kind === 'callRegion';

export const resolveKnownRegion = (
  bundle: KernelProgram,
  state: PipelineState,
  frameKey: Digest,
  moduleAncestry: readonly [string, ...string[]],
  counters?: LookupCounters,
): RegionContext | null => {
  const frame = findFrame(state, frameKey, counters);
  const moduleKey = moduleAncestry.at(-1) ?? moduleAncestry[0];
  const module = findModule(bundle, moduleKey, counters);
  return frame !== null &&
    isRegionFrame(frame) &&
    module !== null &&
    frame.regionId === module.region.id
    ? Object.freeze({
        frame,
        module,
        region: module.region,
        moduleInput: frame.scopeInput,
        moduleAncestry,
      })
    : null;
};

type BaseRegionAncestry = {
  readonly requested: RegionMachineFrame;
  readonly root: RootRegionMachineFrame;
  readonly callNodeIds: readonly string[];
};

const traceBaseRegionAncestry = (
  state: PipelineState,
  frameKey: Digest,
  counters?: LookupCounters,
): BaseRegionAncestry | null => {
  const requested = findFrame(state, frameKey, counters);
  if (requested === null || !isRegionFrame(requested)) {
    return null;
  }
  const callNodeIds: string[] = [];
  let current: MachineFrame | null = requested;
  while (current?.kind === 'callRegion') {
    const callFrame = findFrame(state, current.parentFrameKey, counters);
    if (callFrame?.kind !== 'call') {
      return null;
    }
    callNodeIds.push(callFrame.nodeId);
    current = findFrame(state, callFrame.parentFrameKey, counters);
    if (counters !== undefined) {
      counters.ancestrySteps += 1;
    }
    if (callNodeIds.length > 32) {
      return null;
    }
  }
  return current?.kind === 'rootRegion'
    ? Object.freeze({ requested, root: current, callNodeIds: Object.freeze(callNodeIds) })
    : null;
};

type ModuleAncestry = {
  readonly module: ProgramModule;
  readonly keys: [string, ...string[]];
};

const resolveModuleAncestry = (
  bundle: KernelProgram,
  root: RootRegionMachineFrame,
  callNodeIds: readonly string[],
  counters?: LookupCounters,
): ModuleAncestry | null => {
  let module = findModule(bundle, bundle.program.entryModule, counters);
  if (module?.region.id !== root.regionId) {
    return null;
  }
  const keys: [string, ...string[]] = [bundle.program.entryModule];
  for (const callNodeId of callNodeIds.toReversed()) {
    const node = findNode(module.region, callNodeId, counters);
    if (node?.kind !== 'call') {
      return null;
    }
    const calledModule = findModule(bundle, node.module, counters);
    if (calledModule === null) {
      return null;
    }
    module = calledModule;
    keys.push(module.key);
  }
  return Object.freeze({ module, keys });
};

export const resolveBaseRegion = (
  bundle: KernelProgram,
  state: PipelineState,
  frameKey: Digest,
  counters?: LookupCounters,
): RegionContext | null => {
  const frames = traceBaseRegionAncestry(state, frameKey, counters);
  if (frames === null) {
    return null;
  }
  const modules = resolveModuleAncestry(bundle, frames.root, frames.callNodeIds, counters);
  return modules?.module.region.id !== frames.requested.regionId
    ? null
    : Object.freeze({
        frame: frames.requested,
        module: modules.module,
        region: modules.module.region,
        moduleInput: frames.requested.scopeInput,
        moduleAncestry: Object.freeze(modules.keys),
      });
};
