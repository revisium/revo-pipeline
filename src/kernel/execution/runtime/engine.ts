import {
  isDigest,
  normalizePortableValue,
  type Digest,
  type PipelineFailure,
} from '../../../foundation/index.js';
import { createMachineFault } from '../../contracts/fault-factory.js';
import type { KernelProgram } from '../../contracts/program.js';
import type { PipelineState } from '../../contracts/state.js';
import type { InitialPipelineTransition, PipelineTransition } from '../../contracts/transitions.js';
import {
  createInitializationIdentity,
  readCandidateProgramDigest,
} from '../../identity/initialization.js';
import { inspectKernelProgram } from '../../program/validation.js';
import { classifyOperationEvent, normalizeEvent } from '../../replay/events.js';
import { createRootFrame } from '../../state/frames.js';
import { hydratePipelineState } from '../../state/hydration.js';
import { emptyRunningState, failPipeline, safeInput, ZERO_DIGEST } from '../../state/terminal.js';
import { valueMatchesSchema } from '../selectors.js';
import { requestRunCancellation } from './cancellation.js';
import { applyOperationEvent } from './events.js';
import { createRuntimeTransition, finishRuntimeTransition } from './transition.js';

const emptyCommands: [] = [];
Object.freeze(emptyCommands);

function ownValue(input: KernelProgram, key: 'program'): KernelProgram['program'] | undefined;
function ownValue(input: unknown, key: string): unknown;
function ownValue(input: unknown, key: string): unknown {
  if (typeof input !== 'object' || input === null) {
    return undefined;
  }
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

const rejected = (
  state: PipelineState,
  code: Parameters<typeof createMachineFault>[0],
): PipelineTransition => {
  const fault = createMachineFault(code);
  const faults: readonly [typeof fault, ...(typeof fault)[]] = Object.freeze([fault]);
  return Object.freeze({
    kind: 'rejected',
    state,
    commands: emptyCommands,
    faults,
  });
};

const initializationFailure = (
  bundleInput: unknown,
  code: 'PROGRAM_INVALID' | 'INIT_INPUT_SCHEMA',
  rootFrameKey?: Digest,
): InitialPipelineTransition => {
  const candidate = readCandidateProgramDigest(bundleInput);
  const identity = createInitializationIdentity(candidate);
  const frameKey = rootFrameKey ?? identity.frameKey;
  const programDigest = candidate ?? identity.effectiveProgramDigest;
  const failure: PipelineFailure = Object.freeze({
    code,
    path: code === 'PROGRAM_INVALID' ? '/program' : '/input',
  });
  const terminal = failPipeline(emptyRunningState(programDigest, null), frameKey, failure);
  return Object.freeze({ kind: 'initialized', ...terminal });
};

const invariantAdvance = (state: PipelineState, rootFrameKey: Digest): PipelineTransition =>
  Object.freeze({
    kind: 'advanced',
    ...failPipeline(
      state,
      rootFrameKey,
      Object.freeze({ code: 'INVARIANT_PROGRAM_STATE', path: '' }),
    ),
  });

export const createInitialPipelineState = (
  bundleInput: unknown,
  input: unknown,
): InitialPipelineTransition => {
  const inspection = inspectKernelProgram(bundleInput);
  if (!inspection.ok) {
    return initializationFailure(bundleInput, 'PROGRAM_INVALID');
  }
  const normalized = normalizePortableValue(input);
  const entry = inspection.index.modules.get(inspection.index.bundle.program.entryModule);
  if (
    entry === undefined ||
    !normalized.ok ||
    !valueMatchesSchema(entry.inputSchema, normalized.value) ||
    !valueMatchesSchema(entry.region.inputSchema, normalized.value)
  ) {
    const root = entry === undefined ? null : createRootFrame(entry.region, null);
    return initializationFailure(bundleInput, 'INIT_INPUT_SCHEMA', root?.key);
  }
  const root = createRootFrame(entry.region, normalized.value);
  if (root === null) {
    return initializationFailure(bundleInput, 'PROGRAM_INVALID');
  }
  const state = Object.freeze({
    ...emptyRunningState(inspection.index.bundle.programDigest, normalized.value),
    frames: Object.freeze([root]),
  });
  const runtime = createRuntimeTransition(inspection.index.bundle, state, root.key);
  runtime.context.enqueue(root.key);
  const result = finishRuntimeTransition(runtime);
  return result === null
    ? Object.freeze({
        kind: 'initialized',
        ...failPipeline(
          state,
          root.key,
          Object.freeze({ code: 'INVARIANT_PROGRAM_STATE', path: '' }),
        ),
      })
    : Object.freeze({ kind: 'initialized', ...result });
};

const rootFrameKey = (state: PipelineState): Digest | null =>
  state.frames.find(({ kind }) => kind === 'rootRegion')?.key ?? null;

const trustedBundle = (input: KernelProgram, programDigest: Digest): KernelProgram | null => {
  const program = ownValue(input, 'program');
  const modules = ownValue(program, 'modules');
  const entryModule = ownValue(program, 'entryModule');
  return typeof program === 'object' &&
    program !== null &&
    Array.isArray(modules) &&
    modules.length <= 64 &&
    typeof entryModule === 'string'
    ? Object.freeze({ program, programDigest })
    : null;
};

const advanceHydratedState = (
  bundle: KernelProgram,
  state: PipelineState,
  stateInput: PipelineState,
  rootKey: Digest,
  eventInput: unknown,
): PipelineTransition => {
  const normalized = normalizeEvent(eventInput);
  if (!normalized.ok) {
    return rejected(stateInput, normalized.code);
  }
  const runtime = createRuntimeTransition(bundle, state, rootKey);
  if (normalized.normalized.event.kind === 'cancelRequested') {
    if (state.runCancellation !== null) {
      return Object.freeze({ kind: 'advanced', state: stateInput, commands: emptyCommands });
    }
    const command = requestRunCancellation(
      runtime.context.draft,
      rootKey,
      normalized.normalized.event.reasonCode,
    );
    if (command !== null) {
      runtime.context.draft.addCommand(command);
    }
  } else {
    const causation = classifyOperationEvent(state, normalized.normalized);
    if (causation.kind === 'replay') {
      return Object.freeze({ kind: 'advanced', state: stateInput, commands: emptyCommands });
    }
    if (causation.kind === 'rejected') {
      return rejected(stateInput, causation.code);
    }
    const applied = applyOperationEvent(
      runtime.context,
      causation.operation,
      normalized.normalized,
    );
    if (!applied.ok) {
      return rejected(stateInput, applied.code);
    }
  }
  const result = finishRuntimeTransition(runtime);
  return result === null
    ? invariantAdvance(state, rootKey)
    : Object.freeze({ kind: 'advanced', ...result });
};

export const advancePipeline = (
  bundleInput: KernelProgram,
  stateInput: PipelineState,
  eventInput: unknown,
): PipelineTransition => {
  const bundleDigest = ownValue(bundleInput, 'programDigest');
  const stateDigest = ownValue(stateInput, 'programDigest');
  if (!isDigest(bundleDigest) || !isDigest(stateDigest) || bundleDigest !== stateDigest) {
    return rejected(stateInput, 'PROGRAM_DIGEST_MISMATCH');
  }
  const status = ownValue(stateInput, 'status');
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') {
    return Object.freeze({ kind: 'advanced', state: stateInput, commands: emptyCommands });
  }
  const state = hydratePipelineState(stateInput);
  const bundle = trustedBundle(bundleInput, bundleDigest);
  const rootKey = state === null ? null : rootFrameKey(state);
  if (state === null || bundle === null || rootKey === null) {
    return invariantAdvance(
      state ?? emptyRunningState(stateDigest, safeInput(ownValue(stateInput, 'input'))),
      rootKey ?? ZERO_DIGEST,
    );
  }
  try {
    return advanceHydratedState(bundle, state, stateInput, rootKey, eventInput);
  } catch {
    return invariantAdvance(state, rootKey);
  }
};
