import { describe, expect, test } from 'vitest';

import {
  compilePipeline,
  reducePipeline,
  type PipelineCommand,
  type PipelineSnapshot,
} from '../../../src/index.js';

const pipeline = () => {
  const result = compilePipeline({
    schemaVersion: 1,
    entry: 'task',
    facts: [{ key: 'answer', type: 'string' }],
    nodes: [
      {
        kind: 'task',
        key: 'task',
        outcomes: {
          cancelled: 'finish',
          completed: 'finish',
          failed: 'finish',
          skipped: 'finish',
        },
      },
      { kind: 'terminal', key: 'finish', outcome: 'done' },
    ],
  });
  if (!result.ok) {
    throw new Error('fixture must compile');
  }
  return result.pipeline;
};

const initial = (): PipelineSnapshot => ({
  schemaVersion: 1,
  occurrenceKey: 'run-1',
  phase: 'uninitialized',
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
  terminal: null,
});

const gatePipeline = () => {
  const result = compilePipeline({
    schemaVersion: 1,
    entry: 'gate',
    facts: [{ key: 'reason', type: 'string' }],
    nodes: [
      {
        kind: 'humanGate',
        key: 'gate',
        subject: 'Proceed?',
        resolutions: [{ resolution: 'approved', to: 'finish' }],
      },
      { kind: 'terminal', key: 'finish', outcome: 'done' },
    ],
  });
  if (!result.ok) {
    throw new Error('gate fixture must compile');
  }
  return result.pipeline;
};

const consensusPipeline = () => {
  const result = compilePipeline({
    schemaVersion: 1,
    entry: 'vote',
    facts: [],
    nodes: [
      {
        kind: 'consensus',
        key: 'vote',
        candidates: ['a'],
        policy: { kind: 'unanimous' },
        outcomes: {
          approved: 'finish',
          insufficient: 'finish',
          rejected: 'finish',
          tied: 'finish',
        },
      },
      { kind: 'terminal', key: 'finish', outcome: 'done' },
    ],
  });
  if (!result.ok) {
    throw new Error('consensus fixture must compile');
  }
  return result.pipeline;
};

const twoFactPipeline = () => {
  const result = compilePipeline({
    schemaVersion: 1,
    entry: 'task',
    facts: [
      { key: 'a', type: 'string' },
      { key: 'b', type: 'string' },
    ],
    nodes: [
      {
        kind: 'task',
        key: 'task',
        outcomes: {
          cancelled: 'finish',
          completed: 'finish',
          failed: 'finish',
          skipped: 'finish',
        },
      },
      { kind: 'terminal', key: 'finish', outcome: 'done' },
    ],
  });
  if (!result.ok) {
    throw new Error('two-fact fixture must compile');
  }
  return result.pipeline;
};

describe('reducePipeline', () => {
  test('initializes, drains to a wait, and closes terminally', () => {
    const initialized = reducePipeline(pipeline(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    expect(initialized).toMatchObject({
      ok: true,
      application: 'applied',
      status: 'waiting',
      wait: {
        occurrence: { occurrenceKey: 'run-1', nodeKey: 'task' },
        reason: 'task-incomplete',
      },
      batch: { items: [{ kind: 'initialize' }, { kind: 'activateNode' }] },
    });
    if (!initialized.ok || initialized.snapshot.phase !== 'active') {
      throw new Error('initialization must succeed');
    }
    const completed = reducePipeline(pipeline(), initialized.snapshot, {
      schemaVersion: 1,
      kind: 'taskOutcome',
      occurrence: { occurrenceKey: 'run-1', nodeKey: 'task' },
      outcome: 'completed',
      values: [{ key: 'answer', value: 'yes' }],
    });
    expect(completed).toMatchObject({
      ok: true,
      application: 'applied',
      status: 'terminal',
      terminal: { occurrence: { nodeKey: 'finish' }, outcome: 'done' },
      batch: {
        items: [{ kind: 'completeTask' }, { kind: 'activateNode' }, { kind: 'terminatePipeline' }],
      },
    });
  });

  test('returns unchanged for exact command replay', () => {
    const initialized = reducePipeline(pipeline(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!initialized.ok || initialized.snapshot.phase !== 'active') {
      throw new Error('initialization must succeed');
    }
    expect(
      reducePipeline(pipeline(), initialized.snapshot, {
        schemaVersion: 1,
        kind: 'init',
        values: [],
      }),
    ).toMatchObject({
      ok: true,
      application: 'unchanged',
      batch: { items: [] },
    });
  });

  test('rejects foreign command occurrences before lifecycle', () => {
    const initialized = reducePipeline(pipeline(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!initialized.ok) {
      throw new Error('initialization must succeed');
    }
    expect(
      reducePipeline(pipeline(), initialized.snapshot, {
        schemaVersion: 1,
        kind: 'taskOutcome',
        occurrence: { occurrenceKey: 'foreign', nodeKey: 'task' },
        outcome: 'completed',
        values: [],
      }),
    ).toMatchObject({
      ok: false,
      faults: [{ code: 'COMMAND_TARGET', path: '/command/occurrence/occurrenceKey' }],
    });
  });

  test('contains hostile reflection traps at the owning input', () => {
    const revoked = Proxy.revocable(initial(), {});
    revoked.revoke();
    expect(() =>
      reducePipeline(pipeline(), revoked.proxy, {
        schemaVersion: 1,
        kind: 'init',
        values: [],
      }),
    ).not.toThrow();
    expect(
      reducePipeline(pipeline(), revoked.proxy, {
        schemaVersion: 1,
        kind: 'init',
        values: [],
      }),
    ).toMatchObject({ ok: false, faults: [{ code: 'SNAPSHOT_TYPE', path: '/snapshot' }] });
  });

  test('rejects extra command fields and nonportable fractional values', () => {
    const extra: PipelineCommand & { readonly extra: boolean } = {
      schemaVersion: 1,
      kind: 'init',
      values: [],
      extra: true,
    };
    expect(reducePipeline(pipeline(), initial(), extra)).toMatchObject({
      ok: false,
      faults: [{ code: 'COMMAND_SCHEMA', path: '/command' }],
    });
    expect(
      reducePipeline(pipeline(), initial(), {
        schemaVersion: 1,
        kind: 'init',
        values: [{ key: 'answer', value: 1.5 }],
      }),
    ).toMatchObject({ ok: false, faults: [{ code: 'COMMAND_TYPE' }] });
  });

  test('preserves the exact shape diagnostic for an unknown command kind', () => {
    const command: PipelineCommand = { schemaVersion: 1, kind: 'init', values: [] };
    Object.defineProperty(command, 'kind', { enumerable: true, value: 'unknown' });
    expect(reducePipeline(pipeline(), initial(), command)).toEqual({
      ok: false,
      faults: [
        {
          code: 'COMMAND_SCHEMA',
          path: '/command',
          message: 'Pipeline command shape is invalid.',
        },
      ],
    });
  });

  test('rejects value production for a non-completed task outcome', () => {
    const initialized = reducePipeline(pipeline(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!initialized.ok) {
      throw new Error('initialization must succeed');
    }
    expect(
      reducePipeline(pipeline(), initialized.snapshot, {
        schemaVersion: 1,
        kind: 'taskOutcome',
        occurrence: { occurrenceKey: 'run-1', nodeKey: 'task' },
        outcome: 'failed',
        values: [{ key: 'answer', value: 'unexpected' }],
      }),
    ).toMatchObject({
      ok: false,
      faults: [{ code: 'COMMAND_OUTCOME', path: '/command/values' }],
    });
  });

  test('distinguishes exact task replay from conflicting replay', () => {
    const initialized = reducePipeline(pipeline(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!initialized.ok) {
      throw new Error('initialization must succeed');
    }
    const command = {
      schemaVersion: 1 as const,
      kind: 'taskOutcome' as const,
      occurrence: { occurrenceKey: 'run-1', nodeKey: 'task' },
      outcome: 'completed' as const,
      values: [{ key: 'answer', value: 'yes' }],
    };
    const completed = reducePipeline(pipeline(), initialized.snapshot, command);
    if (!completed.ok) {
      throw new Error('completion must succeed');
    }
    expect(reducePipeline(pipeline(), completed.snapshot, command)).toMatchObject({
      ok: true,
      application: 'unchanged',
      batch: { items: [] },
    });
    expect(
      reducePipeline(pipeline(), completed.snapshot, {
        ...command,
        values: [{ key: 'answer', value: 'different' }],
      }),
    ).toMatchObject({ ok: false, faults: [{ code: 'COMMAND_CONFLICT', path: '/command' }] });
  });

  test('applies, replays, and conflicts a compound human-gate resolution', () => {
    const initialized = reducePipeline(gatePipeline(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!initialized.ok) {
      throw new Error('gate initialization must succeed');
    }
    const command = {
      schemaVersion: 1 as const,
      kind: 'humanGateResolution' as const,
      occurrence: { occurrenceKey: 'run-1', nodeKey: 'gate' },
      resolution: 'approved',
      values: [{ key: 'reason', value: 'accepted' }],
    };
    const resolved = reducePipeline(gatePipeline(), initialized.snapshot, command);
    expect(resolved).toMatchObject({
      ok: true,
      application: 'applied',
      status: 'terminal',
      batch: {
        items: [
          { kind: 'resolveHumanGate' },
          { kind: 'completeSelector' },
          { kind: 'activateNode' },
          { kind: 'terminatePipeline' },
        ],
      },
    });
    if (!resolved.ok) {
      throw new Error('gate resolution must succeed');
    }
    expect(reducePipeline(gatePipeline(), resolved.snapshot, command)).toMatchObject({
      ok: true,
      application: 'unchanged',
      batch: { items: [] },
    });
    expect(
      reducePipeline(gatePipeline(), resolved.snapshot, {
        ...command,
        values: [{ key: 'reason', value: 'different' }],
      }),
    ).toMatchObject({ ok: false, faults: [{ code: 'COMMAND_CONFLICT' }] });
  });

  test('returns newly owned deeply frozen snapshots and effects', () => {
    const source = initial();
    const reduced = reducePipeline(pipeline(), source, {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!reduced.ok) {
      throw new Error('initialization must succeed');
    }
    expect(reduced.snapshot).not.toBe(source);
    expect(Object.isFrozen(reduced)).toBe(true);
    expect(Object.isFrozen(reduced.snapshot)).toBe(true);
    expect(Object.isFrozen(reduced.snapshot.nodes)).toBe(true);
    expect(Object.isFrozen(reduced.batch.items)).toBe(true);
    expect(source).toEqual(initial());
  });

  test('records a consensus verdict and treats exact replay as unchanged', () => {
    const initialized = reducePipeline(consensusPipeline(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!initialized.ok) {
      throw new Error('consensus initialization must succeed');
    }
    const command = {
      schemaVersion: 1 as const,
      kind: 'consensusVerdict' as const,
      occurrence: { occurrenceKey: 'run-1', nodeKey: 'vote' },
      candidate: 'a',
      verdict: 'approve' as const,
    };
    const voted = reducePipeline(consensusPipeline(), initialized.snapshot, command);
    expect(voted).toMatchObject({
      ok: true,
      application: 'applied',
      status: 'terminal',
      batch: {
        items: [
          { kind: 'recordConsensusVerdict' },
          { kind: 'completeSelector' },
          { kind: 'activateNode' },
          { kind: 'terminatePipeline' },
        ],
      },
    });
    if (!voted.ok) {
      throw new Error('consensus vote must succeed');
    }
    expect(reducePipeline(consensusPipeline(), voted.snapshot, command)).toMatchObject({
      ok: true,
      application: 'unchanged',
      batch: { items: [] },
    });
    expect(
      reducePipeline(consensusPipeline(), voted.snapshot, { ...command, verdict: 'reject' }),
    ).toMatchObject({ ok: false, faults: [{ code: 'COMMAND_CONFLICT' }] });
  });

  test('canonicalizes valid snapshot and command permutations before replay', () => {
    const initialized = reducePipeline(twoFactPipeline(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [
        { key: 'b', value: 'second' },
        { key: 'a', value: 'first' },
      ],
    });
    if (!initialized.ok || initialized.snapshot.phase !== 'active') {
      throw new Error('two-fact initialization must succeed');
    }
    expect(initialized.snapshot.values.map((record) => record.fact.key)).toEqual(['a', 'b']);
    const permuted: PipelineSnapshot = {
      ...initialized.snapshot,
      values: [...initialized.snapshot.values].reverse(),
    };
    const replayed = reducePipeline(twoFactPipeline(), permuted, {
      schemaVersion: 1,
      kind: 'init',
      values: [
        { key: 'b', value: 'second' },
        { key: 'a', value: 'first' },
      ],
    });
    expect(replayed).toEqual(
      reducePipeline(twoFactPipeline(), initialized.snapshot, {
        schemaVersion: 1,
        kind: 'init',
        values: [
          { key: 'a', value: 'first' },
          { key: 'b', value: 'second' },
        ],
      }),
    );
  });

  test('reports projected fact faults at the original caller index after permutation', () => {
    const snapshot: PipelineSnapshot = {
      schemaVersion: 1,
      occurrenceKey: 'run-1',
      phase: 'active',
      values: [
        {
          fact: { key: 'b', value: 'valid' },
          source: { kind: 'init', occurrenceKey: 'run-1' },
        },
        {
          fact: { key: 'a', value: 7 },
          source: { kind: 'init', occurrenceKey: 'run-1' },
        },
      ],
      nodes: [
        {
          occurrence: { occurrenceKey: 'run-1', nodeKey: 'task' },
          state: 'enabled',
        },
      ],
      candidateVerdicts: [],
      gateResolutions: [],
      terminal: null,
    };
    expect(
      reducePipeline(twoFactPipeline(), snapshot, {
        schemaVersion: 1,
        kind: 'init',
        values: [],
      }),
    ).toMatchObject({
      ok: false,
      faults: [{ code: 'SNAPSHOT_TYPE', path: '/snapshot/values/1/value' }],
    });
  });

  test('rejects duplicate value identities and foreign value provenance', () => {
    const initialized = reducePipeline(twoFactPipeline(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [{ key: 'a', value: 'first' }],
    });
    if (!initialized.ok || initialized.snapshot.phase !== 'active') {
      throw new Error('initialization must succeed');
    }
    const recorded = initialized.snapshot.values[0];
    if (!recorded) {
      throw new Error('initialization must record a value');
    }
    const duplicate: PipelineSnapshot = {
      ...initialized.snapshot,
      values: [recorded, recorded],
    };
    expect(
      reducePipeline(twoFactPipeline(), duplicate, {
        schemaVersion: 1,
        kind: 'init',
        values: [],
      }),
    ).toMatchObject({
      ok: false,
      faults: [{ code: 'SNAPSHOT_DUPLICATE', path: '/snapshot/values/1/fact/key' }],
    });
    const foreign: PipelineSnapshot = {
      ...initialized.snapshot,
      values: [
        {
          fact: { key: 'a', value: 'first' },
          source: { kind: 'init', occurrenceKey: 'foreign' },
        },
      ],
    };
    expect(
      reducePipeline(twoFactPipeline(), foreign, {
        schemaVersion: 1,
        kind: 'init',
        values: [],
      }),
    ).toMatchObject({
      ok: false,
      faults: [{ code: 'SNAPSHOT_FOREIGN', path: '/snapshot/values/0/source/occurrenceKey' }],
    });
  });

  test('caps diagnostics at 100 and replaces overflow with the limit sentinel', () => {
    const collect = (count: number) => {
      const snapshot: PipelineSnapshot = {
        schemaVersion: 1,
        occurrenceKey: 'run-1',
        phase: 'active',
        values: [],
        nodes: [],
        candidateVerdicts: [],
        gateResolutions: [],
        terminal: null,
      };
      Object.defineProperty(snapshot, 'values', {
        enumerable: true,
        value: Array.from({ length: count }, () => ({})),
      });
      const result = reducePipeline(twoFactPipeline(), snapshot, {
        schemaVersion: 1,
        kind: 'init',
        values: [],
      });
      return result.ok ? [] : result.faults;
    };
    expect(collect(100)).toHaveLength(100);
    const overflow = collect(101);
    expect(overflow).toHaveLength(100);
    expect(overflow.at(-1)).toMatchObject({
      code: 'REDUCTION_DIAGNOSTIC_LIMIT',
      path: '/reduction/faults',
    });
  });

  test('maps compiled decoder diagnostic overflow to the reducer global sentinel', () => {
    const result = compilePipeline({
      schemaVersion: 1,
      entry: 'finish',
      facts: Array.from({ length: 101 }, (_, index) => ({
        key: `fact-${String(index).padStart(3, '0')}`,
        type: 'string' as const,
      })),
      nodes: [{ kind: 'terminal', key: 'finish', outcome: 'done' }],
    });
    if (!result.ok) {
      throw new Error('diagnostic overflow fixture must compile');
    }
    const hostile = structuredClone(result.pipeline);
    Reflect.set(
      hostile,
      'facts',
      hostile.facts.map((fact) => ({ ...fact, type: 'invented' })),
    );
    const reduced = reducePipeline(hostile, initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    expect(reduced.ok ? [] : reduced.faults).toHaveLength(100);
    expect(reduced.ok ? null : reduced.faults.at(-1)).toEqual({
      code: 'REDUCTION_DIAGNOSTIC_LIMIT',
      path: '/reduction/faults',
      message: 'Pipeline reduction diagnostic limit exceeded.',
    });
  });

  test('accepts the maximum reachable 128-value result', () => {
    const result = compilePipeline({
      schemaVersion: 1,
      entry: 'finish',
      facts: Array.from({ length: 128 }, (_, index) => ({
        key: `fact-${String(index).padStart(3, '0')}`,
        type: 'string' as const,
      })),
      nodes: [{ kind: 'terminal', key: 'finish', outcome: 'done' }],
    });
    if (!result.ok) {
      throw new Error('maximum value fixture must compile');
    }
    const reduced = reducePipeline(result.pipeline, initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: result.pipeline.facts.map((fact) => ({ key: fact.key, value: 'maximum' })),
    });
    expect(reduced.ok ? reduced.snapshot.values : []).toHaveLength(128);
  });

  test('rejects snapshot and command collection bounds above 128 values', () => {
    const values = Array.from({ length: 129 }, () => ({
      key: 'a',
      value: 'x',
    }));
    const oversized: PipelineSnapshot = {
      schemaVersion: 1,
      occurrenceKey: 'run-1',
      phase: 'active',
      values: values.map((fact) => ({
        fact,
        source: { kind: 'init', occurrenceKey: 'run-1' },
      })),
      nodes: [],
      candidateVerdicts: [],
      gateResolutions: [],
      terminal: null,
    };
    expect(
      reducePipeline(twoFactPipeline(), oversized, { schemaVersion: 1, kind: 'init', values: [] }),
    ).toMatchObject({ ok: false, faults: [{ code: 'SNAPSHOT_LIMIT' }] });
    expect(
      reducePipeline(twoFactPipeline(), initial(), {
        schemaVersion: 1,
        kind: 'init',
        values,
      }),
    ).toMatchObject({ ok: false, faults: [{ code: 'COMMAND_LIMIT' }] });
  });

  test('checks an oversized array length before invoking ownKeys', () => {
    let ownKeys = 0;
    const values = new Proxy(
      Array.from({ length: 129 }, () => ({})),
      {
        ownKeys() {
          ownKeys += 1;
          throw new Error('must not run');
        },
      },
    );
    const snapshot = initial();
    Object.defineProperty(snapshot, 'values', { enumerable: true, value: values });
    expect(
      reducePipeline(twoFactPipeline(), snapshot, {
        schemaVersion: 1,
        kind: 'init',
        values: [],
      }),
    ).toMatchObject({ ok: false, faults: [{ code: 'SNAPSHOT_LIMIT', path: '/snapshot/values' }] });
    expect(ownKeys).toBe(0);
  });

  test.each([
    [
      'sparse',
      (): unknown[] => {
        const value: unknown[] = [];
        value.length = 1;
        return value;
      },
    ],
    ['extra key', (): unknown[] => Object.assign([] as unknown[], { foo: true })],
    ['noncanonical decimal key', (): unknown[] => Object.assign([] as unknown[], { '01': true })],
    ['symbol key', (): unknown[] => Object.assign([] as unknown[], { [Symbol('extra')]: true })],
  ])('rejects %s arrays without repairing them', (_label, makeValues) => {
    const snapshot = initial();
    Object.defineProperty(snapshot, 'values', { enumerable: true, value: makeValues() });
    expect(
      reducePipeline(twoFactPipeline(), snapshot, {
        schemaVersion: 1,
        kind: 'init',
        values: [],
      }),
    ).toMatchObject({ ok: false, faults: [{ code: 'SNAPSHOT_TYPE' }] });
  });

  test('prunes all child capture when a later container descriptor is an accessor', () => {
    let childReads = 0;
    const nodes = new Proxy([], {
      getPrototypeOf(target) {
        childReads += 1;
        return Reflect.getPrototypeOf(target);
      },
    });
    const snapshot = initial();
    Object.defineProperty(snapshot, 'nodes', { enumerable: true, value: nodes });
    Object.defineProperty(snapshot, 'values', {
      enumerable: true,
      get: () => [],
    });
    expect(
      reducePipeline(twoFactPipeline(), snapshot, {
        schemaVersion: 1,
        kind: 'init',
        values: [],
      }),
    ).toMatchObject({
      ok: false,
      faults: [{ code: 'SNAPSHOT_TYPE', path: '/snapshot/values' }],
    });
    expect(childReads).toBe(0);
  });

  test('inspects malformed snapshot and command stages independently', () => {
    const snapshot = initial();
    Reflect.deleteProperty(snapshot, 'phase');
    const command: PipelineCommand = { schemaVersion: 1, kind: 'init', values: [] };
    Reflect.deleteProperty(command, 'kind');
    const reduced = reducePipeline(twoFactPipeline(), snapshot, command);
    expect(reduced).toEqual({
      ok: false,
      faults: [
        {
          code: 'SNAPSHOT_SCHEMA',
          path: '/snapshot',
          message: 'Pipeline snapshot shape is invalid.',
        },
        {
          code: 'COMMAND_SCHEMA',
          path: '/command',
          message: 'Pipeline command shape is invalid.',
        },
      ],
    });
  });

  test('canonicalizes staggered applied verdict arrivals independent of command permutation', () => {
    const compiled = compilePipeline({
      schemaVersion: 1,
      entry: 'vote',
      facts: [],
      nodes: [
        {
          kind: 'consensus',
          key: 'vote',
          candidates: ['a', 'b'],
          policy: { kind: 'unanimous' },
          outcomes: {
            approved: 'finish',
            insufficient: 'finish',
            rejected: 'finish',
            tied: 'finish',
          },
        },
        { kind: 'terminal', key: 'finish', outcome: 'done' },
      ],
    });
    if (!compiled.ok) {
      throw new Error('canonical verdict fixture must compile');
    }
    const initialized = reducePipeline(compiled.pipeline, initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!initialized.ok || initialized.snapshot.phase !== 'active') {
      throw new Error('canonical verdict fixture must initialize');
    }
    const run = (first: 'a' | 'b', second: 'a' | 'b') => {
      const one = reducePipeline(compiled.pipeline, initialized.snapshot, {
        schemaVersion: 1,
        kind: 'consensusVerdict',
        occurrence: { occurrenceKey: 'run-1', nodeKey: 'vote' },
        candidate: first,
        verdict: 'approve',
      });
      if (!one.ok) {
        throw new Error('first verdict must apply');
      }
      return reducePipeline(compiled.pipeline, one.snapshot, {
        schemaVersion: 1,
        kind: 'consensusVerdict',
        occurrence: { occurrenceKey: 'run-1', nodeKey: 'vote' },
        candidate: second,
        verdict: 'approve',
      });
    };
    const left = run('a', 'b');
    const right = run('b', 'a');
    expect(left.ok && right.ok ? left.snapshot : null).toEqual(
      left.ok && right.ok ? right.snapshot : undefined,
    );
    expect(left.ok ? left.snapshot.candidateVerdicts.map((item) => item.candidate) : []).toEqual([
      'a',
      'b',
    ]);
  });

  test.each([
    ['same scalar', 'owned'],
    ['different scalar', 'different'],
  ])('rejects task and gate values already owned by another source: %s', (_label, value) => {
    const initializedTask = reducePipeline(pipeline(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [{ key: 'answer', value: 'owned' }],
    });
    const initializedGate = reducePipeline(gatePipeline(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [{ key: 'reason', value: 'owned' }],
    });
    if (
      !initializedTask.ok ||
      initializedTask.snapshot.phase !== 'active' ||
      !initializedGate.ok ||
      initializedGate.snapshot.phase !== 'active'
    ) {
      throw new Error('ownership fixtures must initialize');
    }
    expect(
      reducePipeline(pipeline(), initializedTask.snapshot, {
        schemaVersion: 1,
        kind: 'taskOutcome',
        occurrence: { occurrenceKey: 'run-1', nodeKey: 'task' },
        outcome: 'completed',
        values: [{ key: 'answer', value }],
      }),
    ).toMatchObject({
      ok: false,
      faults: [{ code: 'COMMAND_CONFLICT', path: '/command/values' }],
    });
    expect(
      reducePipeline(gatePipeline(), initializedGate.snapshot, {
        schemaVersion: 1,
        kind: 'humanGateResolution',
        occurrence: { occurrenceKey: 'run-1', nodeKey: 'gate' },
        resolution: 'approved',
        values: [{ key: 'reason', value }],
      }),
    ).toMatchObject({
      ok: false,
      faults: [{ code: 'COMMAND_CONFLICT', path: '/command/values' }],
    });
  });
});
