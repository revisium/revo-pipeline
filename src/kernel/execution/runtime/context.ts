import type { Digest, JsonValue, PipelineFailure } from '../../../foundation/index.js';
import type { KernelProgram } from '../../contracts/program.js';
import type { RegionTerminalResult } from '../../contracts/results.js';
import type { TransitionDraft } from './draft.js';
import type { RuntimeProgramIndex } from './program-index.js';

export type RuntimeContext = {
  readonly bundle: KernelProgram;
  readonly index: RuntimeProgramIndex;
  readonly draft: TransitionDraft;
  readonly rootFrameKey: Digest;
  readonly markCancellation: (frameKey: Digest, causality: CancellationCausality) => void;
  readonly cancellationFor: (frameKey: Digest) => CancellationCausality | null;
  readonly markCleanup: (frameKey: Digest, cleanup: RequestedCleanup) => void;
  readonly cleanupFor: (frameKey: Digest) => RequestedCleanup | null;
  readonly completeRequested: (
    frameKey: Digest,
    result: RegionTerminalResult,
    cleanup: RequestedCleanup,
  ) => boolean;
  readonly discard: (frameKey: Digest) => void;
  readonly enqueue: (frameKey: Digest) => void;
  readonly invalidate: () => void;
  readonly isValid: () => boolean;
  readonly selectTerminal: (terminal: RuntimeTerminal) => void;
  readonly terminal: () => RuntimeTerminal | null;
};

export type RequestedCleanup = {
  readonly kind: 'requested';
  readonly ownerKeys: readonly Digest[];
  readonly run: boolean;
};

export type CancellationCausality = 'isolated' | RequestedCleanup;

export type RuntimeTerminal =
  | { readonly kind: 'succeeded'; readonly outcome: string; readonly output: JsonValue }
  | { readonly kind: 'failed'; readonly failure: PipelineFailure }
  | { readonly kind: 'cancelled'; readonly reasonCode: string };
