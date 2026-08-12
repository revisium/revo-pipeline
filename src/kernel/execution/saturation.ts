import { PIPELINE_LIMITS, type Digest, type PipelineFailure } from '../../foundation/index.js';
import type { KernelProgram } from '../contracts/program.js';
import type { PipelineState } from '../contracts/state.js';
import { findNode, resolveKnownRegion, type LookupCounters } from '../program/lookup.js';
import { failPipeline } from '../state/terminal.js';
import type { BaseSaturationResult } from './base-types.js';
import { startActivity } from './steps/activity.js';
import { startCall } from './steps/call.js';
import { selectChoice } from './steps/choice.js';
import { finishRegion } from './steps/end.js';
import type { BaseStepResult } from './steps/types.js';

type Continuation = {
  readonly state: PipelineState;
  readonly frameKey: Digest;
  readonly moduleAncestry: readonly [string, ...string[]];
};

const invariantFailure = (state: PipelineState, rootFrameKey: Digest): BaseSaturationResult => {
  const failure: PipelineFailure = Object.freeze({ code: 'INVARIANT_PROGRAM_STATE', path: '' });
  return Object.freeze({ kind: 'terminal', ...failPipeline(state, rootFrameKey, failure) });
};

const executeNode = (
  bundle: KernelProgram,
  continuation: Continuation,
  rootFrameKey: Digest,
  counters?: LookupCounters,
): BaseStepResult | null => {
  const context = resolveKnownRegion(
    bundle,
    continuation.state,
    continuation.frameKey,
    continuation.moduleAncestry,
    counters,
  );
  const nodeId = context?.frame.ready[0];
  const node =
    context === null || nodeId === undefined ? null : findNode(context.region, nodeId, counters);
  if (context === null || node === null) {
    return null;
  }
  switch (node.kind) {
    case 'activity':
      return startActivity(bundle, continuation.state, context, node);
    case 'choice':
      return selectChoice(continuation.state, context, node, rootFrameKey);
    case 'call':
      return startCall(bundle, continuation.state, context, node, counters);
    case 'end':
      return finishRegion(bundle, continuation.state, context, node, rootFrameKey, counters);
    case 'parallel':
    case 'repeat':
    case 'map':
    case 'wait':
    case 'humanGate':
      return Object.freeze({
        kind: 'deferred-node',
        state: continuation.state,
        frameKey: continuation.frameKey,
        nodeId: node.id,
      });
  }
  return null;
};

export const saturateBase = (
  bundle: KernelProgram,
  state: PipelineState,
  startingFrameKey: Digest,
  startingModuleAncestry: readonly [string, ...string[]],
  rootFrameKey: Digest,
  counters?: LookupCounters,
): BaseSaturationResult => {
  const continuations: Continuation[] = [
    { state, frameKey: startingFrameKey, moduleAncestry: startingModuleAncestry },
  ];
  let cursor = 0;
  while (cursor < continuations.length && cursor <= PIPELINE_LIMITS.sourcePackage.nodes) {
    const continuation = continuations[cursor];
    cursor += 1;
    if (continuation === undefined) {
      break;
    }
    const result = executeNode(bundle, continuation, rootFrameKey, counters);
    if (result === null) {
      return invariantFailure(continuation.state, rootFrameKey);
    }
    if (result.kind !== 'continue') {
      return result;
    }
    continuations.push({
      state: result.state,
      frameKey: result.nextFrameKey,
      moduleAncestry: result.nextModuleAncestry,
    });
  }
  const latest = continuations.at(-1)?.state ?? state;
  return invariantFailure(latest, rootFrameKey);
};
