import { describe, expect, test } from 'vitest';

import { compilePipeline, reducePipeline, type PipelineSnapshot } from '../../../src/index.js';

const compileFork = () => {
  const result = compilePipeline({
    schemaVersion: 1,
    entry: 'fork',
    facts: [],
    nodes: [
      {
        kind: 'fork',
        key: 'fork',
        join: 'join',
        branches: [
          { name: 'a', entry: 'a', exit: 'a' },
          { name: 'b', entry: 'b', exit: 'b' },
        ],
      },
      {
        kind: 'task',
        key: 'a',
        outcomes: { cancelled: 'join', completed: 'join', failed: 'join', skipped: 'join' },
      },
      {
        kind: 'task',
        key: 'b',
        outcomes: { cancelled: 'join', completed: 'join', failed: 'join', skipped: 'join' },
      },
      {
        kind: 'join',
        key: 'join',
        fork: 'fork',
        policy: { kind: 'any', remaining: 'unconstrained' },
        outcomes: { completed: 'end', insufficient: 'end', rejected: 'end' },
      },
      { kind: 'terminal', key: 'end', outcome: 'done' },
    ],
  });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.faults));
  }
  return result.pipeline;
};

const initial = (): PipelineSnapshot => ({
  schemaVersion: 1,
  occurrenceKey: 'fork-run',
  phase: 'uninitialized',
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
  terminal: null,
});

const compileRetiredConsensus = () => {
  const result = compilePipeline({
    schemaVersion: 1,
    entry: 'fork',
    facts: [],
    nodes: [
      {
        kind: 'fork',
        key: 'fork',
        join: 'join',
        branches: [
          { name: 'winner', entry: 'task', exit: 'task' },
          { name: 'loser', entry: 'vote', exit: 'vote-exit' },
        ],
      },
      {
        kind: 'task',
        key: 'task',
        outcomes: { cancelled: 'join', completed: 'join', failed: 'join', skipped: 'join' },
      },
      {
        kind: 'consensus',
        key: 'vote',
        candidates: ['x', 'y'],
        policy: { kind: 'unanimous' },
        outcomes: {
          approved: 'vote-exit',
          insufficient: 'vote-exit',
          rejected: 'vote-exit',
          tied: 'vote-exit',
        },
      },
      {
        kind: 'task',
        key: 'vote-exit',
        outcomes: { cancelled: 'join', completed: 'join', failed: 'join', skipped: 'join' },
      },
      {
        kind: 'join',
        key: 'join',
        fork: 'fork',
        policy: { kind: 'any', remaining: 'unconstrained' },
        outcomes: { completed: 'end', insufficient: 'end', rejected: 'end' },
      },
      { kind: 'terminal', key: 'end', outcome: 'done' },
    ],
  });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.faults));
  }
  return result.pipeline;
};

const compileRetiredGate = () => {
  const result = compilePipeline({
    schemaVersion: 1,
    entry: 'fork',
    facts: [{ key: 'reason', type: 'string' }],
    nodes: [
      {
        kind: 'fork',
        key: 'fork',
        join: 'join',
        branches: [
          { name: 'winner', entry: 'task', exit: 'task' },
          { name: 'loser', entry: 'gate', exit: 'gate-exit' },
        ],
      },
      {
        kind: 'task',
        key: 'task',
        outcomes: { cancelled: 'join', completed: 'join', failed: 'join', skipped: 'join' },
      },
      {
        kind: 'humanGate',
        key: 'gate',
        subject: 'Proceed?',
        resolutions: [{ resolution: 'approved', to: 'gate-exit' }],
      },
      {
        kind: 'task',
        key: 'gate-exit',
        outcomes: { cancelled: 'join', completed: 'join', failed: 'join', skipped: 'join' },
      },
      {
        kind: 'join',
        key: 'join',
        fork: 'fork',
        policy: { kind: 'any', remaining: 'unconstrained' },
        outcomes: { completed: 'end', insufficient: 'end', rejected: 'end' },
      },
      { kind: 'terminal', key: 'end', outcome: 'done' },
    ],
  });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.faults));
  }
  return result.pipeline;
};

describe('reducePipeline fork relations and retirement', () => {
  test('orders fork activations and derives entryExit and join relations', () => {
    const initialized = reducePipeline(compileFork(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    expect(initialized).toMatchObject({
      ok: true,
      status: 'waiting',
      wait: { occurrence: { nodeKey: 'a' }, reason: 'task-incomplete' },
      batch: {
        items: [
          { kind: 'initialize' },
          { kind: 'activateNode', occurrence: { nodeKey: 'fork' }, fork: { kind: 'none' } },
          { kind: 'completeSelector', occurrence: { nodeKey: 'fork' } },
          {
            kind: 'activateNode',
            occurrence: { nodeKey: 'a' },
            fork: { kind: 'branch', branch: 'a', role: 'entryExit' },
          },
          {
            kind: 'activateNode',
            occurrence: { nodeKey: 'b' },
            fork: { kind: 'branch', branch: 'b', role: 'entryExit' },
          },
          {
            kind: 'activateNode',
            occurrence: { nodeKey: 'join' },
            fork: { kind: 'join', role: 'join' },
          },
        ],
      },
    });
  });

  test('retires exactly the losing enabled branch in topology order', () => {
    const initialized = reducePipeline(compileFork(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!initialized.ok) {
      throw new Error('fork initialization must succeed');
    }
    const completed = reducePipeline(compileFork(), initialized.snapshot, {
      schemaVersion: 1,
      kind: 'taskOutcome',
      occurrence: { occurrenceKey: 'fork-run', nodeKey: 'a' },
      outcome: 'completed',
      values: [],
    });
    expect(completed).toMatchObject({
      ok: true,
      status: 'terminal',
      snapshot: {
        nodes: [
          { occurrence: { nodeKey: 'fork' }, state: 'terminal' },
          { occurrence: { nodeKey: 'a' }, state: 'terminal' },
          { occurrence: { nodeKey: 'b' }, state: 'retired' },
          { occurrence: { nodeKey: 'join' }, state: 'terminal' },
          { occurrence: { nodeKey: 'end' }, state: 'terminal' },
        ],
      },
      batch: {
        items: [
          { kind: 'completeTask', occurrence: { nodeKey: 'a' } },
          { kind: 'completeSelector', occurrence: { nodeKey: 'join' } },
          { kind: 'activateNode', occurrence: { nodeKey: 'end' } },
          {
            kind: 'terminatePipeline',
            retirements: [
              {
                occurrence: { nodeKey: 'b' },
                fork: { kind: 'branch', branch: 'b', role: 'entryExit' },
              },
            ],
          },
        ],
      },
    });
  });

  test('preserves retired verdict history, filters it from projection, and replays it', () => {
    const initialized = reducePipeline(compileRetiredConsensus(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!initialized.ok) {
      throw new Error('retired-evidence initialization must succeed');
    }
    const vote = {
      schemaVersion: 1 as const,
      kind: 'consensusVerdict' as const,
      occurrence: { occurrenceKey: 'fork-run', nodeKey: 'vote' },
      candidate: 'x',
      verdict: 'approve' as const,
    };
    const voted = reducePipeline(compileRetiredConsensus(), initialized.snapshot, vote);
    if (!voted.ok) {
      throw new Error('partial verdict must succeed');
    }
    const completed = reducePipeline(compileRetiredConsensus(), voted.snapshot, {
      schemaVersion: 1,
      kind: 'taskOutcome',
      occurrence: { occurrenceKey: 'fork-run', nodeKey: 'task' },
      outcome: 'completed',
      values: [],
    });
    expect(completed).toMatchObject({
      ok: true,
      status: 'terminal',
      snapshot: {
        candidateVerdicts: [
          { occurrence: { nodeKey: 'vote' }, candidate: 'x', verdict: 'approve' },
        ],
      },
    });
    if (!completed.ok) {
      throw new Error('winner completion must succeed');
    }
    expect(
      completed.snapshot.nodes.find((node) => node.occurrence.nodeKey === 'vote'),
    ).toMatchObject({ state: 'retired' });
    const replay = reducePipeline(compileRetiredConsensus(), completed.snapshot, vote);
    if (!replay.ok) {
      throw new Error(JSON.stringify(replay.faults));
    }
    expect(replay).toMatchObject({
      ok: true,
      application: 'unchanged',
      batch: { items: [] },
    });
    expect(
      reducePipeline(compileRetiredConsensus(), completed.snapshot, {
        ...vote,
        verdict: 'reject',
      }),
    ).toMatchObject({ ok: false, faults: [{ code: 'COMMAND_CONFLICT' }] });
  });

  test('accepts matching retired gate evidence and value provenance for exact replay', () => {
    const initialized = reducePipeline(compileRetiredGate(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!initialized.ok) {
      throw new Error('retired gate initialization must succeed');
    }
    const closed = reducePipeline(compileRetiredGate(), initialized.snapshot, {
      schemaVersion: 1,
      kind: 'taskOutcome',
      occurrence: { occurrenceKey: 'fork-run', nodeKey: 'task' },
      outcome: 'completed',
      values: [],
    });
    if (!closed.ok || closed.snapshot.phase !== 'terminal') {
      throw new Error('winner must close the retired-gate fixture');
    }
    const occurrence = { occurrenceKey: 'fork-run', nodeKey: 'gate' };
    const ownedHistorical: PipelineSnapshot = {
      ...closed.snapshot,
      values: [
        {
          fact: { key: 'reason', value: 'accepted' },
          source: { kind: 'init', occurrenceKey: 'fork-run' },
        },
      ],
    };
    ['accepted', 'different'].forEach((value) => {
      expect(
        reducePipeline(compileRetiredGate(), ownedHistorical, {
          schemaVersion: 1,
          kind: 'humanGateResolution',
          occurrence,
          resolution: 'approved',
          values: [{ key: 'reason', value }],
        }),
      ).toMatchObject({
        ok: false,
        faults: [{ code: 'COMMAND_STATE', path: '/command/occurrence' }],
      });
    });
    const historical: PipelineSnapshot = {
      ...closed.snapshot,
      values: [
        {
          fact: { key: 'reason', value: 'accepted' },
          source: { kind: 'humanGateResolution', occurrence },
        },
      ],
      gateResolutions: [{ occurrence, resolution: 'approved' }],
    };
    const command = {
      schemaVersion: 1 as const,
      kind: 'humanGateResolution' as const,
      occurrence,
      resolution: 'approved',
      values: [{ key: 'reason', value: 'accepted' }],
    };
    expect(reducePipeline(compileRetiredGate(), historical, command)).toMatchObject({
      ok: true,
      application: 'unchanged',
      batch: { items: [] },
    });
    expect(
      reducePipeline(compileRetiredGate(), historical, {
        ...command,
        values: [{ key: 'reason', value: 'different' }],
      }),
    ).toMatchObject({ ok: false, faults: [{ code: 'COMMAND_CONFLICT' }] });
  });
});
