import { beforeAll, describe, expect, test } from 'vitest';

import {
  compilePipeline,
  reducePipeline,
  type CompiledPipeline,
  type PipelineCommand,
  type PipelineSnapshot,
} from '../../../src/index.js';

let pipeline: CompiledPipeline;
let waitingTask: PipelineSnapshot;

beforeAll(() => {
  const compiled = compilePipeline({
    schemaVersion: 1,
    entry: 'task',
    facts: [{ key: 'owned', type: 'string' }],
    nodes: [
      {
        kind: 'task',
        key: 'task',
        outcomes: {
          cancelled: 'vote',
          completed: 'vote',
          failed: 'vote',
          skipped: 'vote',
        },
      },
      {
        kind: 'consensus',
        key: 'vote',
        candidates: ['candidate'],
        policy: { kind: 'unanimous' },
        outcomes: {
          approved: 'gate',
          insufficient: 'gate',
          rejected: 'gate',
          tied: 'gate',
        },
      },
      {
        kind: 'humanGate',
        key: 'gate',
        subject: 'Proceed?',
        resolutions: [{ resolution: 'approved', to: 'future-task' }],
      },
      {
        kind: 'task',
        key: 'future-task',
        outcomes: {
          cancelled: 'end',
          completed: 'end',
          failed: 'end',
          skipped: 'end',
        },
      },
      { kind: 'terminal', key: 'end', outcome: 'done' },
    ],
  });
  if (!compiled.ok) {
    throw new Error('command matrix fixture must compile');
  }
  pipeline = compiled.pipeline;
  const initialized = reducePipeline(
    pipeline,
    {
      schemaVersion: 1,
      occurrenceKey: 'matrix-run',
      phase: 'uninitialized',
      values: [],
      nodes: [],
      candidateVerdicts: [],
      gateResolutions: [],
      terminal: null,
    },
    {
      schemaVersion: 1,
      kind: 'init',
      values: [{ key: 'owned', value: 'original' }],
    },
  );
  if (!initialized.ok) {
    throw new Error('command matrix initialization must succeed');
  }
  waitingTask = initialized.snapshot;
});

describe('reducePipeline command domain and lifecycle matrix', () => {
  test.each([
    {
      name: 'task command targeting consensus',
      command: {
        schemaVersion: 1 as const,
        kind: 'taskOutcome' as const,
        occurrence: { occurrenceKey: 'matrix-run', nodeKey: 'vote' },
        outcome: 'completed' as const,
        values: [],
      },
      path: '/command/occurrence/nodeKey',
    },
    {
      name: 'undeclared consensus candidate',
      command: {
        schemaVersion: 1 as const,
        kind: 'consensusVerdict' as const,
        occurrence: { occurrenceKey: 'matrix-run', nodeKey: 'vote' },
        candidate: 'foreign',
        verdict: 'approve' as const,
      },
      path: '/command/candidate',
    },
    {
      name: 'undeclared gate resolution',
      command: {
        schemaVersion: 1 as const,
        kind: 'humanGateResolution' as const,
        occurrence: { occurrenceKey: 'matrix-run', nodeKey: 'gate' },
        resolution: 'foreign',
        values: [],
      },
      path: '/command/resolution',
    },
  ])('rejects domain mismatch before lifecycle: $name', ({ command, path }) => {
    expect(reducePipeline(pipeline, waitingTask, command)).toMatchObject({
      ok: false,
      faults: [{ code: 'COMMAND_TARGET', path }],
    });
  });

  test.each([
    {
      schemaVersion: 1 as const,
      kind: 'consensusVerdict' as const,
      occurrence: { occurrenceKey: 'matrix-run', nodeKey: 'vote' },
      candidate: 'candidate',
      verdict: 'approve' as const,
    },
    {
      schemaVersion: 1 as const,
      kind: 'humanGateResolution' as const,
      occurrence: { occurrenceKey: 'matrix-run', nodeKey: 'gate' },
      resolution: 'approved',
      values: [],
    },
  ])('rejects a valid but omitted target as COMMAND_STATE', (command) => {
    expect(reducePipeline(pipeline, waitingTask, command)).toMatchObject({
      ok: false,
      faults: [{ code: 'COMMAND_STATE', path: '/command/occurrence' }],
    });
  });

  test.each([
    ['task', 'equal', 'original'],
    ['task', 'different', 'replacement'],
    ['gate', 'equal', 'original'],
    ['gate', 'different', 'replacement'],
  ] as const)(
    'gives omitted $0 lifecycle precedence over $1 cross-source ownership',
    (kind, _valueCase, value) => {
      const command: PipelineCommand =
        kind === 'task'
          ? {
              schemaVersion: 1,
              kind: 'taskOutcome',
              occurrence: { occurrenceKey: 'matrix-run', nodeKey: 'future-task' },
              outcome: 'completed',
              values: [{ key: 'owned', value }],
            }
          : {
              schemaVersion: 1,
              kind: 'humanGateResolution',
              occurrence: { occurrenceKey: 'matrix-run', nodeKey: 'gate' },
              resolution: 'approved',
              values: [{ key: 'owned', value }],
            };
      expect(reducePipeline(pipeline, waitingTask, command)).toMatchObject({
        ok: false,
        faults: [{ code: 'COMMAND_STATE', path: '/command/occurrence' }],
      });
    },
  );

  test('reports invalid task outcome without an empty fault result', () => {
    const command: PipelineCommand = {
      schemaVersion: 1,
      kind: 'taskOutcome',
      occurrence: { occurrenceKey: 'matrix-run', nodeKey: 'task' },
      outcome: 'completed',
      values: [],
    };
    Object.defineProperty(command, 'outcome', { enumerable: true, value: 'unknown' });
    expect(reducePipeline(pipeline, waitingTask, command)).toMatchObject({
      ok: false,
      faults: [{ code: 'COMMAND_OUTCOME', path: '/command' }],
    });
  });
});
