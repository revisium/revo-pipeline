import { expect, test } from 'vitest';

import {
  PACKAGE_CONSUMER_CASES,
  assertConsumerComplete,
  authorizeConsumerEvent,
  commitConsumerEvent,
  initialConsumerCompletionState,
} from '../../../scripts/package/package-consumer-catalog.js';

test('owns exactly seventeen cases with eleven type and runtime checks', () => {
  expect(PACKAGE_CONSUMER_CASES).toHaveLength(17);
  expect(PACKAGE_CONSUMER_CASES.filter(({ type }) => type)).toHaveLength(11);
  expect(PACKAGE_CONSUMER_CASES.filter(({ runtime }) => runtime)).toHaveLength(11);
  expect(Object.isFrozen(PACKAGE_CONSUMER_CASES)).toBe(true);
  expect(new Set(PACKAGE_CONSUMER_CASES.map(({ id }) => id)).size).toBe(17);
});

test('poisons irreversibly on duplicate or out-of-order lifecycle events', () => {
  const initial = initialConsumerCompletionState();
  const denied = authorizeConsumerEvent(initial, 'positive', 'typeScript');
  expect(denied.ok).toBe(false);
  if (denied.ok) {
    return;
  }
  expect(denied.state.kind).toBe('poisoned');
  const repeated = authorizeConsumerEvent(denied.state, 'positive', 'createType');
  expect(repeated.ok).toBe(false);
  expect(repeated.state).toBe(denied.state);
  const incomplete = assertConsumerComplete(denied.state);
  expect(incomplete.ok).toBe(false);
  expect(incomplete.state).toBe(denied.state);
});

test('requires creation before completion and commits an immutable next state', () => {
  const initial = initialConsumerCompletionState();
  const authorized = authorizeConsumerEvent(initial, 'positive', 'createType');
  expect(authorized.ok).toBe(true);
  if (!authorized.ok) {
    return;
  }
  const committed = commitConsumerEvent(authorized.state, authorized.value);
  expect(committed.ok).toBe(true);
  if (!committed.ok) {
    return;
  }
  expect(initial).not.toBe(committed.state);
  expect(Object.isFrozen(committed.state)).toBe(true);
  expect(commitConsumerEvent(authorized.state, { ...authorized.value }).ok).toBe(false);
  expect(commitConsumerEvent(committed.state, authorized.value).ok).toBe(false);
});

test('rejects and poisons every runtime phase outside the exact finite union', () => {
  for (const phase of ['', 'runtime', 'create', 'execute', null, 1, {}]) {
    const result = authorizeConsumerEvent(initialConsumerCompletionState(), 'runtime', phase);
    expect(result.ok).toBe(false);
    expect(result.state.kind).toBe('poisoned');
  }
});
