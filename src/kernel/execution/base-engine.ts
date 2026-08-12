import {
  isDigest,
  normalizePortableValue,
  type Digest,
  type PipelineFailure,
} from '../../foundation/index.js';
import { requestRunCancellation } from '../cancellation/run.js';
import { createMachineFault } from '../contracts/fault-factory.js';
import type { KernelProgram } from '../contracts/program.js';
import type { PipelineState } from '../contracts/state.js';
import {
  createInitializationIdentity,
  readCandidateProgramDigest,
} from '../identity/initialization.js';
import type { LookupCounters } from '../program/lookup.js';
import { inspectKernelProgram } from '../program/validation.js';
import { classifyOperationEvent, normalizeEvent } from '../replay/events.js';
import { ownPipelineState } from '../state/canonical.js';
import { createRootFrame } from '../state/frames.js';
import { hydratePipelineState } from '../state/hydration.js';
import { ZERO_DIGEST, emptyRunningState, failPipeline, safeInput } from '../state/terminal.js';
import { applyActivityEvent } from './activity-event.js';
import type { BaseEngineResult, BaseRejectedResult } from './base-types.js';
import { saturateBase } from './saturation.js';
import { valueMatchesSchema } from './selectors.js';

const rejected = (
  state: PipelineState,
  code: Parameters<typeof createMachineFault>[0],
): BaseRejectedResult => {
  const faults: [ReturnType<typeof createMachineFault>] = [createMachineFault(code)];
  return Object.freeze({
    kind: 'rejected',
    state,
    faults: Object.freeze(faults),
  });
};

function ownData(input: KernelProgram, key: 'program'): KernelProgram['program'] | undefined;
function ownData(input: unknown, key: string): unknown;
function ownData(input: unknown, key: string): unknown {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
    const value: unknown =
      descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
    return value;
  } catch {
    return undefined;
  }
}

const initializationFailure = (
  bundleInput: unknown,
  code: 'PROGRAM_INVALID' | 'INIT_INPUT_SCHEMA',
  rootFrameKey?: Digest,
): BaseEngineResult => {
  const candidateProgramDigest = readCandidateProgramDigest(bundleInput);
  const initializationIdentity = createInitializationIdentity(candidateProgramDigest);
  const frameKey = rootFrameKey ?? initializationIdentity.frameKey;
  const programDigest = candidateProgramDigest ?? initializationIdentity.effectiveProgramDigest;
  const state = emptyRunningState(programDigest, null);
  const failure: PipelineFailure = Object.freeze({
    code,
    path: code === 'PROGRAM_INVALID' ? '/program' : '/input',
  });
  return Object.freeze({
    kind: 'terminal',
    ...failPipeline(state, frameKey, failure),
  });
};

export const initializeBaseKernel = (bundleInput: unknown, input: unknown): BaseEngineResult => {
  const inspection = inspectKernelProgram(bundleInput);
  if (!inspection.ok) {
    return initializationFailure(bundleInput, 'PROGRAM_INVALID');
  }
  const normalizedInput = normalizePortableValue(input);
  const entryModule = inspection.index.modules.get(inspection.index.bundle.program.entryModule);
  if (entryModule === undefined) {
    return initializationFailure(inspection.index.bundle, 'PROGRAM_INVALID');
  }
  if (
    !normalizedInput.ok ||
    !valueMatchesSchema(entryModule.inputSchema, normalizedInput.value) ||
    !valueMatchesSchema(entryModule.region.inputSchema, normalizedInput.value)
  ) {
    const rootFrame = createRootFrame(entryModule.region, null);
    return initializationFailure(inspection.index.bundle, 'INIT_INPUT_SCHEMA', rootFrame?.key);
  }
  const rootFrame = createRootFrame(entryModule.region, normalizedInput.value);
  if (rootFrame === null) {
    return initializationFailure(inspection.index.bundle, 'PROGRAM_INVALID');
  }
  const state = ownPipelineState({
    ...emptyRunningState(inspection.index.bundle.programDigest, normalizedInput.value),
    frames: [rootFrame],
  });
  return saturateBase(
    inspection.index.bundle,
    state,
    rootFrame.key,
    [entryModule.key],
    rootFrame.key,
  );
};

const readPinnedDigest = (input: unknown): Digest | null => {
  const value = ownData(input, 'programDigest');
  return isDigest(value) ? value : null;
};

const findRootFrameKey = (state: PipelineState): Digest | null =>
  state.frames.find(({ kind }) => kind === 'rootRegion')?.key ?? null;

const trustedBundle = (input: KernelProgram, programDigest: Digest): KernelProgram | null => {
  const program = ownData(input, 'program');
  const modules = ownData(program, 'modules');
  const entryModule = ownData(program, 'entryModule');
  return typeof program === 'object' &&
    program !== null &&
    Array.isArray(modules) &&
    modules.length <= 64 &&
    typeof entryModule === 'string'
    ? Object.freeze({ program, programDigest })
    : null;
};

const invariantResult = (state: PipelineState, rootFrameKey: Digest): BaseEngineResult => {
  const failure: PipelineFailure = Object.freeze({ code: 'INVARIANT_PROGRAM_STATE', path: '' });
  return Object.freeze({ kind: 'terminal', ...failPipeline(state, rootFrameKey, failure) });
};

const advanceHydratedState = (
  bundle: KernelProgram,
  state: PipelineState,
  stateInput: PipelineState,
  rootKey: Digest,
  eventInput: unknown,
  counters?: LookupCounters,
): BaseEngineResult => {
  const normalized = normalizeEvent(eventInput);
  if (!normalized.ok) {
    return rejected(stateInput, normalized.code);
  }
  if (normalized.normalized.event.kind === 'cancelRequested') {
    if (state.runCancellation !== null) {
      return Object.freeze({ kind: 'boundary', state: stateInput, commands: Object.freeze([]) });
    }
    const result = requestRunCancellation(state, rootKey, normalized.normalized.event.reasonCode);
    return Object.freeze({
      kind: result.terminal ? 'terminal' : 'boundary',
      state: result.state,
      commands: result.commands,
    });
  }
  const causation = classifyOperationEvent(state, normalized.normalized);
  if (causation.kind === 'replay') {
    return Object.freeze({ kind: 'boundary', state: stateInput, commands: Object.freeze([]) });
  }
  if (causation.kind === 'rejected') {
    return rejected(stateInput, causation.code);
  }
  if (causation.operation.kind !== 'activity') {
    return rejected(stateInput, 'EVENT_OPERATION_KIND');
  }
  return (
    applyActivityEvent(
      bundle,
      state,
      normalized.normalized,
      causation.operation,
      rootKey,
      counters,
    ) ?? invariantResult(state, rootKey)
  );
};

export const advanceBaseKernel = (
  bundleInput: KernelProgram,
  stateInput: PipelineState,
  eventInput: unknown,
  counters?: LookupCounters,
): BaseEngineResult => {
  const bundleDigest = readPinnedDigest(bundleInput);
  const stateDigest = readPinnedDigest(stateInput);
  if (bundleDigest === null || stateDigest === null || bundleDigest !== stateDigest) {
    return rejected(stateInput, 'PROGRAM_DIGEST_MISMATCH');
  }
  const pinnedStatus = ownData(stateInput, 'status');
  if (pinnedStatus === 'succeeded' || pinnedStatus === 'failed' || pinnedStatus === 'cancelled') {
    return Object.freeze({ kind: 'boundary', state: stateInput, commands: Object.freeze([]) });
  }
  const state = hydratePipelineState(stateInput);
  const bundle = trustedBundle(bundleInput, bundleDigest);
  const rootKey = state === null ? null : findRootFrameKey(state);
  if (state === null || bundle === null || rootKey === null) {
    return invariantResult(
      state ?? emptyRunningState(stateDigest, safeInput(ownData(stateInput, 'input'))),
      rootKey ?? ZERO_DIGEST,
    );
  }
  try {
    return advanceHydratedState(bundle, state, stateInput, rootKey, eventInput, counters);
  } catch {
    return invariantResult(state, rootKey);
  }
};
