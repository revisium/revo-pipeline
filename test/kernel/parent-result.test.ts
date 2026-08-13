import { describe, expect, it } from 'vitest';

import { kernelModule, kernelProgram, kernelRegion } from '../support/kernel-builders.js';
import {
  createCallFrames,
  createRootFrame,
  createRuntimeProgramIndex,
  createTransitionDraft,
  emptyRunningState,
  routeImmediateResult,
  routeOwnedResult,
  succeededNode,
  type RuntimeContext,
} from '../support/kernel-internal.js';
import { programEnd, programId, programNodeExamples } from '../support/program-builders.js';

const runtimeContext = () => {
  const end = programEnd();
  const region = kernelRegion([end]);
  const bundle = kernelProgram([kernelModule('main', region)]);
  const root = createRootFrame(region, {});
  if (root === null) {
    throw new TypeError('Expected a root frame.');
  }
  const draft = createTransitionDraft(
    Object.freeze({
      ...emptyRunningState(bundle.programDigest, {}),
      frames: Object.freeze([root]),
    }),
  );
  const enqueued: string[] = [];
  const context: RuntimeContext = {
    bundle,
    index: createRuntimeProgramIndex(bundle.program),
    draft,
    rootFrameKey: root.key,
    markCancellation: () => undefined,
    cancellationFor: () => null,
    markCleanup: () => undefined,
    cleanupFor: () => null,
    completeRequested: () => false,
    discard: () => undefined,
    enqueue: (key) => enqueued.push(key),
    invalidate: () => undefined,
    isValid: () => true,
    selectTerminal: () => undefined,
    terminal: () => null,
  };
  return { context, root, region, target: region.entry, enqueued };
};

describe('parent result routing', () => {
  it('records an immediate result exactly once', () => {
    const { context, root, target, enqueued } = runtimeContext();
    expect(routeImmediateResult(context, root.key, target, succeededNode({}), target)).toBe(true);
    expect(enqueued).toEqual([root.key]);
    expect(routeImmediateResult(context, root.key, target, succeededNode({}), target)).toBe(false);
  });

  it('copies an owned result exactly once', () => {
    const { context, root, target, enqueued } = runtimeContext();
    const ownerId = programId('7');
    expect(routeOwnedResult(context, root.key, ownerId, succeededNode({}), target)).toBe(true);
    expect(enqueued).toEqual([root.key]);
    expect(routeOwnedResult(context, root.key, ownerId, succeededNode({}), target)).toBe(false);
  });

  it('rejects missing and non-region parents', () => {
    const { context, root, region, target } = runtimeContext();
    context.draft.deleteFrame(root.key);
    expect(routeImmediateResult(context, root.key, target, succeededNode({}), target)).toBe(false);
    expect(routeOwnedResult(context, root.key, programId('7'), succeededNode({}), target)).toBe(
      false,
    );

    const call = programNodeExamples().find((node) => node.kind === 'call');
    if (call?.kind !== 'call') {
      throw new TypeError('Expected a call node.');
    }
    const frames = createCallFrames(root.key, call, region, {});
    if (frames === null) {
      throw new TypeError('Expected call frames.');
    }
    context.draft.setFrame(frames.owner);
    expect(routeImmediateResult(context, frames.owner.key, target, succeededNode({}), target)).toBe(
      false,
    );
    expect(
      routeOwnedResult(context, frames.owner.key, programId('7'), succeededNode({}), target),
    ).toBe(false);
  });
});
