import type { Digest, PipelineFailure } from '../../foundation/index.js';
import { acknowledgeCancellation, finishAcknowledgedCancellation } from '../cancellation/run.js';
import type { PipelineEvent } from '../contracts/events.js';
import type { PendingOperation } from '../contracts/operations.js';
import type { KernelProgram } from '../contracts/program.js';
import type { NodeTerminalResult } from '../contracts/results.js';
import type { PipelineState } from '../contracts/state.js';
import { findNode, resolveBaseRegion, type LookupCounters } from '../program/lookup.js';
import type { NormalizedEvent } from '../replay/events.js';
import {
  pruneResolvedReceipts,
  replaceFrame,
  replacePendingWithReceipt,
} from '../state/canonical.js';
import type { BaseSaturationResult } from './base-types.js';
import { recordPendingNodeResult } from './region-state.js';
import { saturateBase } from './saturation.js';
import { valueMatchesSchema } from './selectors.js';

type ActivityEvent = Extract<PipelineEvent, { readonly kind: `activity${string}` }>;

const isActivityEvent = (event: PipelineEvent): event is ActivityEvent =>
  event.kind === 'activitySucceeded' ||
  event.kind === 'activityFailed' ||
  event.kind === 'activityCancelled';

const activityResult = (
  event: ActivityEvent,
  outputMatches: boolean,
): {
  readonly result: NodeTerminalResult;
  readonly route: 'succeeded' | 'failed' | 'cancelled';
} => {
  if (event.kind === 'activitySucceeded' && outputMatches) {
    return Object.freeze({
      result: Object.freeze({ status: 'succeeded', output: event.output }),
      route: 'succeeded',
    });
  }
  if (event.kind === 'activityCancelled') {
    return Object.freeze({
      result: Object.freeze({ status: 'cancelled' }),
      route: 'cancelled',
    });
  }
  const failure: PipelineFailure = Object.freeze({
    code: event.kind === 'activityFailed' ? event.errorCode : 'DATA_SCHEMA_MISMATCH',
    path: '',
  });
  return Object.freeze({
    result: Object.freeze({ status: 'failed', failure }),
    route: 'failed',
  });
};

export const applyActivityEvent = (
  bundle: KernelProgram,
  state: PipelineState,
  normalized: NormalizedEvent,
  pending: Extract<PendingOperation, { readonly kind: 'activity' }>,
  rootFrameKey: Digest,
  counters?: LookupCounters,
): BaseSaturationResult | null => {
  const event = normalized.event;
  if (!isActivityEvent(event)) {
    return null;
  }
  const context = resolveBaseRegion(bundle, state, pending.ref.frameKey, counters);
  const node = context === null ? null : findNode(context.region, pending.ref.nodeId, counters);
  if (context === null || node?.kind !== 'activity') {
    return null;
  }
  const receipt = Object.freeze({
    commandKey: pending.commandKey,
    ref: pending.ref,
    eventDigest: normalized.eventDigest,
  });
  let nextState = replacePendingWithReceipt(state, pending, receipt);
  nextState = acknowledgeCancellation(nextState, pending.commandKey);
  const outcome = activityResult(
    event,
    event.kind === 'activitySucceeded' && valueMatchesSchema(node.outputSchema, event.output),
  );
  const frame = recordPendingNodeResult(
    context.frame,
    node.id,
    outcome.result,
    node.routes[outcome.route],
  );
  if (frame === null) {
    return null;
  }
  nextState = replaceFrame(nextState, frame);
  if (nextState.status === 'cancelling') {
    const terminal = finishAcknowledgedCancellation(nextState, rootFrameKey);
    return terminal === null
      ? Object.freeze({ kind: 'boundary', state: nextState, commands: Object.freeze([]) })
      : Object.freeze({ kind: 'terminal', ...terminal });
  }
  return pruneSaturation(
    saturateBase(bundle, nextState, frame.key, context.moduleAncestry, rootFrameKey, counters),
  );
};

const pruneSaturation = (result: BaseSaturationResult): BaseSaturationResult =>
  result.kind === 'deferred-node'
    ? result
    : Object.freeze({ ...result, state: pruneResolvedReceipts(result.state) });
