import { compareUnicodeCodePoints, type Digest } from '../../foundation/index.js';
import type {
  ProgramModule,
  ProgramNode,
  ProgramRegion,
  ProgramRegionExit,
} from '../../program/index.js';
import type { MachineFrame } from '../contracts/frames.js';
import type { KernelProgram } from '../contracts/program.js';
import type { RegionMachineFrame } from '../contracts/region-frames.js';
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

export const resolveBaseRegion = (
  bundle: KernelProgram,
  state: PipelineState,
  frameKey: Digest,
  counters?: LookupCounters,
): RegionContext | null => {
  const callNodeIds: string[] = [];
  let current = findFrame(state, frameKey, counters);
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
  if (current?.kind !== 'rootRegion') {
    return null;
  }
  let module = findModule(bundle, bundle.program.entryModule, counters);
  let moduleInput = current.scopeInput;
  const moduleAncestry: [string, ...string[]] = [bundle.program.entryModule];
  if (module === null || module.region.id !== current.regionId) {
    return null;
  }
  while (callNodeIds.length > 0) {
    const callNodeId = callNodeIds.pop();
    const node = callNodeId === undefined ? null : findNode(module.region, callNodeId, counters);
    if (node?.kind !== 'call') {
      return null;
    }
    module = findModule(bundle, node.module, counters);
    if (module === null) {
      return null;
    }
    moduleAncestry.push(module.key);
  }
  const requested = findFrame(state, frameKey, counters);
  if (requested !== null && isRegionFrame(requested)) {
    moduleInput = requested.scopeInput;
  }
  return requested !== null && isRegionFrame(requested) && requested.regionId === module.region.id
    ? Object.freeze({
        frame: requested,
        module,
        region: module.region,
        moduleInput,
        moduleAncestry: Object.freeze(moduleAncestry),
      })
    : null;
};
