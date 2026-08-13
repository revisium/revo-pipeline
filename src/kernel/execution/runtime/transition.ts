import type { Digest } from '../../../foundation/index.js';
import type { KernelProgram } from '../../contracts/program.js';
import type { PipelineState } from '../../contracts/state.js';
import { cancelCommand, completeCommand, failCommand, pipelineReference } from '../commands.js';
import type {
  CancellationCausality,
  RequestedCleanup,
  RuntimeContext,
  RuntimeTerminal,
} from './context.js';
import { createTransitionDraft } from './draft.js';
import { createRuntimeProgramIndex } from './program-index.js';
import { completeRequestedCancellation } from './region-completion.js';
import { drainRuntimeQueue } from './saturate.js';

export const createRuntimeTransition = (
  bundle: KernelProgram,
  state: PipelineState,
  rootFrameKey: Digest,
) => {
  const draft = createTransitionDraft(state);
  const queue: Digest[] = [];
  const queued = new Set<Digest>();
  const discarded = new Set<Digest>();
  const cancellations = new Map<Digest, CancellationCausality>();
  const cleanups = new Map<Digest, RequestedCleanup>();
  let queueIndex = 0;
  let valid = true;
  let terminal: RuntimeTerminal | null = null;
  const context: RuntimeContext = {
    bundle,
    index: createRuntimeProgramIndex(bundle.program),
    draft,
    rootFrameKey,
    markCancellation: (frameKey, causality) => {
      if (causality !== 'isolated' || !cancellations.has(frameKey)) {
        cancellations.set(frameKey, causality);
      }
    },
    cancellationFor: (frameKey) => cancellations.get(frameKey) ?? null,
    markCleanup: (frameKey, cleanup) => cleanups.set(frameKey, cleanup),
    cleanupFor: (frameKey) => cleanups.get(frameKey) ?? null,
    completeRequested: (frameKey, result, cleanup) =>
      completeRequestedCancellation(context, frameKey, result, cleanup),
    discard: (frameKey) => {
      if (queued.has(frameKey)) {
        discarded.add(frameKey);
      }
    },
    enqueue: (key) => {
      if (!queued.has(key)) {
        queued.add(key);
        queue.push(key);
      }
    },
    invalidate: () => (valid = false),
    isValid: () => valid,
    selectTerminal: (selected) => {
      terminal ??= Object.freeze(selected);
    },
    terminal: () => terminal,
  };
  const take = (): Digest | undefined => {
    while (queueIndex < queue.length) {
      const key = queue[queueIndex];
      queueIndex += 1;
      if (key === undefined) {
        return undefined;
      }
      queued.delete(key);
      if (discarded.delete(key)) {
        continue;
      }
      return key;
    }
    return undefined;
  };
  return Object.freeze({ context, take });
};

const writeTerminalState = (context: RuntimeContext): void => {
  const selected = context.terminal();
  if (
    selected === null ||
    context.draft.pending.size > 0 ||
    context.draft.regionCancellations.size > 0
  ) {
    return;
  }
  context.draft.clearExecution();
  const ref = pipelineReference(context.draft.programDigest, context.rootFrameKey);
  if (selected.kind === 'succeeded') {
    context.draft.setStatus('succeeded');
    context.draft.setResult(Object.freeze({ outcome: selected.outcome, output: selected.output }));
    const command = completeCommand(ref, selected.outcome, selected.output);
    if (command === null || !context.draft.addCommand(command)) {
      context.invalidate();
    }
    return;
  }
  if (selected.kind === 'failed') {
    context.draft.setStatus('failed');
    context.draft.setFault(selected.failure);
    const command = failCommand(ref, selected.failure);
    if (command === null || !context.draft.addCommand(command)) {
      context.invalidate();
    }
    return;
  }
  context.draft.setStatus('cancelled');
  context.draft.setRunCancellation(
    Object.freeze({ reasonCode: selected.reasonCode, awaiting: Object.freeze([]) }),
  );
  const command = cancelCommand(ref, selected.reasonCode);
  if (command === null || !context.draft.addCommand(command)) {
    context.invalidate();
  }
};

const selectSettledCancellation = (context: RuntimeContext): void => {
  const cancellation = context.draft.getRunCancellation();
  if (
    cancellation !== null &&
    cancellation.awaiting.length === 0 &&
    context.draft.regionCancellations.size === 0
  ) {
    context.selectTerminal({ kind: 'cancelled', reasonCode: cancellation.reasonCode });
  }
};

export const finishRuntimeTransition = (
  runtime: ReturnType<typeof createRuntimeTransition>,
): {
  readonly state: PipelineState;
  readonly commands: ReturnType<RuntimeContext['draft']['outputCommands']>;
} | null => {
  drainRuntimeQueue(runtime.context, runtime.take);
  selectSettledCancellation(runtime.context);
  writeTerminalState(runtime.context);
  runtime.context.draft.pruneReceipts();
  const state = runtime.context.draft.state();
  return runtime.context.isValid() && state !== null
    ? Object.freeze({ state, commands: runtime.context.draft.outputCommands() })
    : null;
};
