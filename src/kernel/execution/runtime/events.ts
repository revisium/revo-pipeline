import { isDigest, type Digest, type JsonPointer } from '../../../foundation/index.js';
import type { MachineFaultCode } from '../../contracts/faults.js';
import type { PendingOperation } from '../../contracts/operations.js';
import type { RegionMachineFrame } from '../../contracts/region-frames.js';
import type { NodeTerminalResult } from '../../contracts/results.js';
import type { NormalizedEvent } from '../../replay/events.js';
import { recordPendingNodeResult, storePendingNodeResult } from '../region-state.js';
import { valueMatchesSchema } from '../selectors.js';
import { orderedCancellationOwners } from './cancellation.js';
import type { RequestedCleanup, RuntimeContext } from './context.js';
import { findRuntimeNode, resolveRuntimeRegion } from './program-index.js';
import { completeFailedRegion } from './region-completion.js';
import { cleanupRegionResult, failedNode, failure } from './results.js';

type Applied =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: MachineFaultCode; readonly path?: JsonPointer };

const applied: Applied = Object.freeze({ ok: true });

type RoutedResult =
  | {
      readonly result: NodeTerminalResult;
      readonly target: Digest;
    }
  | { readonly failure: ReturnType<typeof failure> };

type RejectedEvent = { readonly code: MachineFaultCode; readonly path: JsonPointer };

type RoutedEventResult = RoutedResult | RejectedEvent | MachineFaultCode | null;

const isCancellationEvent = (event: NormalizedEvent['event']): boolean =>
  event.kind === 'activityCancelled' ||
  event.kind === 'waitCancelled' ||
  event.kind === 'gateCancelled';

const activityResult = (
  context: RuntimeContext,
  pending: Extract<PendingOperation, { readonly kind: 'activity' }>,
  normalized: NormalizedEvent,
): RoutedResult | null => {
  const event = normalized.event;
  const frame = context.draft.frames.get(pending.ref.frameKey);
  const region =
    frame === undefined ? null : resolveRuntimeRegion(frame.key, context.draft, context.index);
  const node =
    region === null ? null : findRuntimeNode(context.index, region.region, pending.ref.nodeId);
  if (node?.kind !== 'activity') {
    return null;
  }
  if (event.kind === 'activityCancelled') {
    return Object.freeze({
      result: Object.freeze({ status: 'cancelled' }),
      target: node.routes.cancelled,
    });
  }
  if (event.kind === 'activityFailed') {
    return Object.freeze({
      result: Object.freeze({ status: 'failed', failure: failure(event.errorCode) }),
      target: node.routes.failed,
    });
  }
  if (event.kind !== 'activitySucceeded') {
    return null;
  }
  return valueMatchesSchema(node.outputSchema, event.output)
    ? Object.freeze({
        result: Object.freeze({ status: 'succeeded', output: event.output }),
        target: node.routes.succeeded,
      })
    : Object.freeze({
        result: Object.freeze({ status: 'failed', failure: failure('DATA_SCHEMA_MISMATCH') }),
        target: node.routes.failed,
      });
};

const waitResult = (
  context: RuntimeContext,
  pending: Extract<PendingOperation, { readonly kind: 'wait' }>,
  normalized: NormalizedEvent,
): RoutedEventResult => {
  const event = normalized.event;
  const frame = context.draft.frames.get(pending.ref.frameKey);
  const region =
    frame === undefined ? null : resolveRuntimeRegion(frame.key, context.draft, context.index);
  const node =
    region === null ? null : findRuntimeNode(context.index, region.region, pending.ref.nodeId);
  if (node?.kind !== 'wait') {
    return null;
  }
  if (event.kind === 'waitCancelled') {
    return Object.freeze({
      result: Object.freeze({ status: 'cancelled' }),
      target: node.routes.cancelled,
    });
  }
  if (node.wait.kind === 'duration') {
    return event.kind === 'waitCompleted'
      ? Object.freeze({
          result: Object.freeze({ status: 'succeeded', output: null }),
          target: node.routes.completed,
        })
      : 'EVENT_SIGNAL';
  }
  if (event.kind !== 'signalReceived' || event.signal !== node.wait.signal) {
    return 'EVENT_SIGNAL';
  }
  if (
    (node.wait.payloadSchema === null && event.payload !== null) ||
    (node.wait.payloadSchema !== null &&
      !valueMatchesSchema(node.wait.payloadSchema, event.payload))
  ) {
    return Object.freeze({ failure: failure('DATA_SCHEMA_MISMATCH', '/payload') });
  }
  return Object.freeze({
    result: Object.freeze({
      status: 'succeeded',
      output: node.wait.payloadSchema === null ? null : event.payload,
    }),
    target: node.routes.completed,
  });
};

const gateResult = (
  context: RuntimeContext,
  pending: Extract<PendingOperation, { readonly kind: 'humanGate' }>,
  normalized: NormalizedEvent,
): RoutedEventResult => {
  const event = normalized.event;
  const frame = context.draft.frames.get(pending.ref.frameKey);
  const region =
    frame === undefined ? null : resolveRuntimeRegion(frame.key, context.draft, context.index);
  const node =
    region === null ? null : findRuntimeNode(context.index, region.region, pending.ref.nodeId);
  if (node?.kind !== 'humanGate') {
    return null;
  }
  if (event.kind === 'gateCancelled') {
    return Object.freeze({
      result: Object.freeze({ status: 'cancelled' }),
      target: node.routes.cancelled,
    });
  }
  if (event.kind !== 'gateResolved') {
    return null;
  }
  const resolution = event.resolution;
  if (resolution.kind === 'answer') {
    const route = node.routes.answers.find(({ answer }) => answer === resolution.answer);
    if (route === undefined) {
      return 'EVENT_GATE_ANSWER';
    }
    if (
      (node.payloadSchema === null && resolution.payload !== null) ||
      (node.payloadSchema !== null && !valueMatchesSchema(node.payloadSchema, resolution.payload))
    ) {
      return Object.freeze({
        code: 'DATA_SCHEMA_MISMATCH',
        path: '/payload',
      });
    }
    return Object.freeze({
      result: Object.freeze({ status: 'succeeded', output: resolution }),
      target: route.target,
    });
  }
  return node.deadline === null
    ? 'EVENT_GATE_ANSWER'
    : Object.freeze({
        result: Object.freeze({ status: 'succeeded', output: resolution }),
        target: node.deadline.target,
      });
};

const routedResult = (
  context: RuntimeContext,
  pending: PendingOperation,
  normalized: NormalizedEvent,
): RoutedEventResult => {
  switch (pending.kind) {
    case 'activity':
      return activityResult(context, pending, normalized);
    case 'wait':
      return waitResult(context, pending, normalized);
    case 'humanGate':
      return gateResult(context, pending, normalized);
  }
  pending satisfies never;
  return null;
};

const storeCleanupResult = (
  context: RuntimeContext,
  frame: RegionMachineFrame,
  nodeId: PendingOperation['ref']['nodeId'],
  result: NodeTerminalResult,
  cleanup: RequestedCleanup,
): void => {
  const stored = isDigest(nodeId) ? storePendingNodeResult(frame, nodeId, result) : null;
  if (stored === null) {
    context.invalidate();
    return;
  }
  context.draft.setFrame(stored);
  context.draft.charge();
  if (!context.completeRequested(frame.key, cleanupRegionResult(result), cleanup)) {
    context.invalidate();
  }
};

const applyOrdinaryResult = (
  context: RuntimeContext,
  frame: RegionMachineFrame,
  pending: PendingOperation,
  routed: RoutedResult,
  runCancellation: boolean,
): void => {
  if ('failure' in routed) {
    if (runCancellation) {
      const stored = isDigest(pending.ref.nodeId)
        ? storePendingNodeResult(frame, pending.ref.nodeId, failedNode(routed.failure))
        : null;
      if (stored === null) {
        context.invalidate();
      } else {
        context.draft.setFrame(stored);
        context.draft.charge();
      }
      return;
    }
    if (!completeFailedRegion(context, frame, routed.failure)) {
      context.invalidate();
    }
    return;
  }
  const updated = isDigest(pending.ref.nodeId)
    ? recordPendingNodeResult(frame, pending.ref.nodeId, routed.result, routed.target)
    : null;
  if (updated === null) {
    context.invalidate();
    return;
  }
  context.draft.setFrame(updated);
  context.draft.charge();
  if (!runCancellation) {
    context.enqueue(updated.key);
  }
};

const rejectedApplication = (routed: RoutedEventResult): Applied | null => {
  if (typeof routed === 'string') {
    return Object.freeze({ ok: false, code: routed });
  }
  return routed !== null && 'code' in routed
    ? Object.freeze({ ok: false, code: routed.code, path: routed.path })
    : null;
};

const isRoutedResult = (routed: RoutedEventResult): routed is RoutedResult =>
  routed !== null && typeof routed !== 'string' && !('code' in routed);

type CleanupPreparation = {
  readonly requested: ReturnType<RuntimeContext['draft']['acknowledge']>;
  readonly cleanup: RequestedCleanup;
};

const prepareCleanup = (
  context: RuntimeContext,
  frame: RegionMachineFrame,
  pending: PendingOperation,
): CleanupPreparation | null => {
  const requested = context.draft.acknowledge(pending.commandKey);
  const ownerKeys =
    requested === null
      ? Object.freeze([])
      : orderedCancellationOwners(context.draft, frame.key, requested.regionOwnerKeys);
  if (ownerKeys === null) {
    return null;
  }
  return Object.freeze({
    requested,
    cleanup: Object.freeze({
      kind: 'requested' as const,
      ownerKeys,
      run: requested?.run ?? false,
    }),
  });
};

const applyCancellationResult = (
  context: RuntimeContext,
  frame: RegionMachineFrame,
  pending: PendingOperation,
  preparation: CleanupPreparation,
  normalized: NormalizedEvent,
): boolean => {
  if (!isCancellationEvent(normalized.event)) {
    return false;
  }
  if (preparation.requested === null) {
    context.markCancellation(frame.key, 'isolated');
    return false;
  }
  if (preparation.cleanup.ownerKeys.length > 0) {
    storeCleanupResult(
      context,
      frame,
      pending.ref.nodeId,
      Object.freeze({ status: 'cancelled' }),
      preparation.cleanup,
    );
  }
  return true;
};

export const applyOperationEvent = (
  context: RuntimeContext,
  pending: PendingOperation,
  normalized: NormalizedEvent,
): Applied => {
  const routed = routedResult(context, pending, normalized);
  const rejected = rejectedApplication(routed);
  if (rejected !== null) {
    return rejected;
  }
  const frame = context.draft.frames.get(pending.ref.frameKey);
  if (!isRoutedResult(routed) || frame === undefined || !('ready' in frame)) {
    context.invalidate();
    return applied;
  }
  const receipt = Object.freeze({
    commandKey: pending.commandKey,
    ref: pending.ref,
    eventDigest: normalized.eventDigest,
  });
  if (!context.draft.replacePending(pending, receipt)) {
    context.invalidate();
    return applied;
  }
  const preparation = prepareCleanup(context, frame, pending);
  if (preparation === null) {
    context.invalidate();
    return applied;
  }
  if (applyCancellationResult(context, frame, pending, preparation, normalized)) {
    return applied;
  }
  if (preparation.cleanup.ownerKeys.length > 0) {
    const exactResult = 'failure' in routed ? failedNode(routed.failure) : routed.result;
    storeCleanupResult(context, frame, pending.ref.nodeId, exactResult, preparation.cleanup);
    return applied;
  }
  applyOrdinaryResult(context, frame, pending, routed, preparation.cleanup.run);
  return applied;
};
