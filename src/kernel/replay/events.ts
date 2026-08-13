import { Compile } from 'typebox/compile';

import {
  canonicalizeOwnedValue,
  normalizePortableValue,
  type Digest,
} from '../../foundation/index.js';
import { PipelineEventSchema, type PipelineEvent } from '../contracts/events.js';
import type { MachineFaultCode } from '../contracts/faults.js';
import type { PendingOperation, ResolvedOperation } from '../contracts/operations.js';
import type { PipelineState } from '../contracts/state.js';
import { computeEventDigest } from '../identity/digests.js';

const eventValidator = Compile(PipelineEventSchema);
const activityEvents = new Set(['activitySucceeded', 'activityFailed', 'activityCancelled']);

export type NormalizedEvent = {
  readonly event: PipelineEvent;
  readonly eventDigest: Digest;
};

export type EventNormalization =
  | { readonly ok: true; readonly normalized: NormalizedEvent }
  | { readonly ok: false; readonly code: 'EVENT_SCHEMA' | 'EVENT_EXECUTOR_OUTCOME' };

const looksLikeExecutorOutcome = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (Object.hasOwn(value, 'status') || Object.hasOwn(value, 'outcome')) {
    return true;
  }
  const descriptor = Reflect.getOwnPropertyDescriptor(value, 'kind');
  const kind: unknown =
    descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  return typeof kind === 'string' && kind.startsWith('activity') && !activityEvents.has(kind);
};

export const normalizeEvent = (input: unknown): EventNormalization => {
  const owned = normalizePortableValue(input);
  if (!owned.ok) {
    return Object.freeze({ ok: false, code: 'EVENT_SCHEMA' });
  }
  if (looksLikeExecutorOutcome(owned.value)) {
    return Object.freeze({ ok: false, code: 'EVENT_EXECUTOR_OUTCOME' });
  }
  if (!eventValidator.Check(owned.value)) {
    return Object.freeze({ ok: false, code: 'EVENT_SCHEMA' });
  }
  const eventDigest = computeEventDigest(owned.value);
  return eventDigest === null
    ? Object.freeze({ ok: false, code: 'EVENT_SCHEMA' })
    : Object.freeze({
        ok: true,
        normalized: Object.freeze({ event: owned.value, eventDigest }),
      });
};

const findByCommandKey = <Value extends { readonly commandKey: string }>(
  values: readonly Value[],
  commandKey: string,
): Value | null => {
  let lower = 0;
  let upper = values.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const value = values[middle];
    if (value === undefined) {
      return null;
    }
    if (value.commandKey === commandKey) {
      return value;
    }
    if (value.commandKey < commandKey) {
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }
  }
  return null;
};

const sameReference = (left: unknown, right: unknown): boolean =>
  canonicalizeOwnedValue(left).text === canonicalizeOwnedValue(right).text;

export type OperationCausation =
  | { readonly kind: 'pending'; readonly operation: PendingOperation }
  | { readonly kind: 'replay' }
  | { readonly kind: 'rejected'; readonly code: MachineFaultCode };

const operationAcceptsEvent = (pending: PendingOperation, event: PipelineEvent): boolean => {
  switch (pending.kind) {
    case 'activity':
      return activityEvents.has(event.kind);
    case 'wait':
      return (
        event.kind === 'waitCancelled' ||
        (pending.waitKind === 'duration'
          ? event.kind === 'waitCompleted'
          : event.kind === 'signalReceived')
      );
    case 'humanGate':
      return event.kind === 'gateResolved' || event.kind === 'gateCancelled';
  }
  return false;
};

export const classifyOperationEvent = (
  state: PipelineState,
  normalized: NormalizedEvent,
): OperationCausation => {
  const event = normalized.event;
  if (event.kind === 'cancelRequested') {
    return Object.freeze({ kind: 'rejected', code: 'EVENT_OPERATION_KIND' });
  }
  const resolved = findByCommandKey<ResolvedOperation>(state.resolved, event.commandKey);
  if (resolved !== null) {
    return resolved.eventDigest === normalized.eventDigest && sameReference(resolved.ref, event.ref)
      ? Object.freeze({ kind: 'replay' })
      : Object.freeze({ kind: 'rejected', code: 'EVENT_CONFLICT' });
  }
  const pending = findByCommandKey<PendingOperation>(state.pending, event.commandKey);
  if (pending === null || !sameReference(pending.ref, event.ref)) {
    return Object.freeze({ kind: 'rejected', code: 'EVENT_FOREIGN' });
  }
  return operationAcceptsEvent(pending, event)
    ? Object.freeze({ kind: 'pending', operation: pending })
    : Object.freeze({ kind: 'rejected', code: 'EVENT_OPERATION_KIND' });
};
