import type { Digest } from '../../../foundation/index.js';
import type {
  PipelineProgram,
  ProgramModule,
  ProgramNode,
  ProgramRegion,
} from '../../../program/index.js';
import type { MachineFrame } from '../../contracts/frames.js';
import type { RegionMachineFrame } from '../../contracts/region-frames.js';
import { findSorted, type LookupCounters } from '../../program/lookup.js';
import type { TransitionDraft } from './draft.js';

type RegionOwner = {
  readonly module: ProgramModule;
  readonly region: ProgramRegion;
};

export type RuntimeLookupCounters = LookupCounters & {
  moduleLookups: number;
  nodeLookups: number;
  regionResolutions: number;
};

export type RuntimeProgramIndex = {
  readonly program: PipelineProgram;
  readonly counters: RuntimeLookupCounters | undefined;
  readonly modules: Map<string, ProgramModule>;
  readonly regions: Map<Digest, RegionOwner>;
};

export type RuntimeRegionContext = RegionOwner & {
  readonly frame: RegionMachineFrame;
  readonly moduleInput: RegionMachineFrame['scopeInput'];
};

export const createRuntimeProgramIndex = (
  program: PipelineProgram,
  counters?: RuntimeLookupCounters,
): RuntimeProgramIndex =>
  Object.freeze({ program, counters, modules: new Map(), regions: new Map() });

export const findRuntimeModule = (
  index: RuntimeProgramIndex,
  key: string,
): ProgramModule | null => {
  const cached = index.modules.get(key);
  if (cached !== undefined) {
    return cached;
  }
  if (index.counters !== undefined) {
    index.counters.moduleLookups += 1;
  }
  const module = findSorted(
    index.program.modules,
    key,
    (candidate) => candidate.key,
    index.counters,
  );
  if (module !== null) {
    index.modules.set(key, module);
  }
  return module;
};

export const findRuntimeNode = (
  index: RuntimeProgramIndex,
  region: ProgramRegion,
  id: string,
): ProgramNode | null => {
  if (index.counters !== undefined) {
    index.counters.nodeLookups += 1;
  }
  return findSorted(region.nodes, id, (node) => node.id, index.counters);
};

export const isRegionFrame = (frame: MachineFrame): frame is RegionMachineFrame =>
  frame.kind === 'rootRegion' ||
  frame.kind === 'callRegion' ||
  frame.kind === 'parallelBranch' ||
  frame.kind === 'repeatBody' ||
  frame.kind === 'mapItem';

const moduleInputFor = (
  frame: RegionMachineFrame,
  draft: TransitionDraft,
): RegionMachineFrame['scopeInput'] | null => {
  let current: MachineFrame | undefined = frame;
  for (let depth = 0; depth <= 64; depth += 1) {
    if (current.kind === 'rootRegion' || current.kind === 'callRegion') {
      return current.scopeInput;
    }
    current = draft.frames.get(current.parentFrameKey);
    if (current === undefined) {
      return null;
    }
  }
  return null;
};

const nestedRegionOwner = (
  frame: Exclude<RegionMachineFrame, { readonly kind: 'rootRegion' }>,
  draft: TransitionDraft,
  index: RuntimeProgramIndex,
): RegionOwner | null => {
  const owner = draft.frames.get(frame.parentFrameKey);
  const parentFrameKey = owner?.parentFrameKey;
  if (parentFrameKey === undefined || parentFrameKey === null) {
    return null;
  }
  const parent = resolveRuntimeRegion(parentFrameKey, draft, index);
  if (owner === undefined || parent === null || !('nodeId' in owner)) {
    return null;
  }
  const node = findRuntimeNode(index, parent.region, owner.nodeId);
  if (node === null) {
    return null;
  }
  if (frame.kind === 'callRegion' && owner.kind === 'call' && node.kind === 'call') {
    const module = findRuntimeModule(index, node.module);
    return module === null ? null : Object.freeze({ module, region: module.region });
  }
  if (frame.kind === 'parallelBranch' && owner.kind === 'parallel' && node.kind === 'parallel') {
    const branches: readonly { readonly key: string; readonly region: ProgramRegion }[] =
      node.branches;
    const branch = findSorted(branches, frame.branchKey, (candidate) => candidate.key);
    return branch === null ? null : Object.freeze({ module: parent.module, region: branch.region });
  }
  if (frame.kind === 'repeatBody' && owner.kind === 'repeat' && node.kind === 'repeat') {
    return Object.freeze({ module: parent.module, region: node.body });
  }
  if (frame.kind === 'mapItem' && owner.kind === 'map' && node.kind === 'map') {
    return Object.freeze({ module: parent.module, region: node.body });
  }
  return null;
};

const regionOwner = (
  frame: RegionMachineFrame,
  draft: TransitionDraft,
  index: RuntimeProgramIndex,
): RegionOwner | null => {
  const cached = index.regions.get(frame.key);
  if (cached !== undefined) {
    return cached;
  }
  if (index.counters !== undefined) {
    index.counters.regionResolutions += 1;
  }
  const owner =
    frame.kind === 'rootRegion'
      ? (() => {
          const module = findRuntimeModule(index, index.program.entryModule);
          return module === null ? null : Object.freeze({ module, region: module.region });
        })()
      : nestedRegionOwner(frame, draft, index);
  if (owner?.region.id !== frame.regionId) {
    return null;
  }
  index.regions.set(frame.key, owner);
  return owner;
};

export const resolveRuntimeRegion = (
  frameKey: Digest,
  draft: TransitionDraft,
  index: RuntimeProgramIndex,
): RuntimeRegionContext | null => {
  const frame = draft.frames.get(frameKey);
  if (frame === undefined || !isRegionFrame(frame)) {
    return null;
  }
  const owner = regionOwner(frame, draft, index);
  const moduleInput = moduleInputFor(frame, draft);
  return owner === null || moduleInput === null
    ? null
    : Object.freeze({ ...owner, frame, moduleInput });
};
