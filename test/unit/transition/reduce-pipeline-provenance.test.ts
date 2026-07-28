import { describe, expect, test } from 'vitest';

import {
  compilePipeline,
  reducePipeline,
  type CompiledPipeline,
  type PipelineSnapshot,
} from '../../../src/index.js';

const compileSource = (kind: 'task' | 'gate'): CompiledPipeline => {
  const source =
    kind === 'task'
      ? {
          kind: 'task' as const,
          key: 'source',
          outcomes: {
            cancelled: 'end',
            completed: 'end',
            failed: 'end',
            skipped: 'end',
          },
        }
      : {
          kind: 'humanGate' as const,
          key: 'source',
          subject: 'Proceed?',
          resolutions: [{ resolution: 'approved', to: 'end' }],
        };
  const result = compilePipeline({
    schemaVersion: 1,
    entry: 'source',
    facts: [{ key: 'value', type: 'string' }],
    nodes: [source, { kind: 'terminal', key: 'end', outcome: 'done' }],
  });
  if (!result.ok) {
    throw new Error('provenance fixture must compile');
  }
  return result.pipeline;
};

const initialized = (
  pipeline: CompiledPipeline,
): Extract<PipelineSnapshot, { readonly phase: 'active' }> => {
  const reduced = reducePipeline(
    pipeline,
    {
      schemaVersion: 1,
      occurrenceKey: 'provenance-run',
      phase: 'uninitialized',
      values: [],
      nodes: [],
      candidateVerdicts: [],
      gateResolutions: [],
      terminal: null,
    },
    { schemaVersion: 1, kind: 'init', values: [] },
  );
  if (!reduced.ok || reduced.snapshot.phase !== 'active') {
    throw new Error('provenance initialization must succeed');
  }
  return reduced.snapshot;
};

const replayInit = { schemaVersion: 1 as const, kind: 'init' as const, values: [] };
const occurrence = { occurrenceKey: 'provenance-run', nodeKey: 'source' };

describe('reducePipeline value provenance prerequisites', () => {
  test('rejects enabled, omitted, and non-completed task sources as premature or outcome faults', () => {
    const pipeline = compileSource('task');
    const active = initialized(pipeline);
    const value = {
      fact: { key: 'value', value: 'recorded' },
      source: { kind: 'taskOutcome' as const, occurrence },
    };
    expect(reducePipeline(pipeline, { ...active, values: [value] }, replayInit)).toEqual({
      ok: false,
      faults: [
        {
          code: 'SNAPSHOT_PREMATURE',
          path: '/snapshot/values/0/source',
          message: 'Snapshot task source is not completed.',
        },
      ],
    });
    expect(reducePipeline(pipeline, { ...active, values: [value], nodes: [] }, replayInit)).toEqual(
      {
        ok: false,
        faults: [
          {
            code: 'SNAPSHOT_PREMATURE',
            path: '/snapshot/values/0/source',
            message: 'Snapshot value source is not completed.',
          },
        ],
      },
    );
    expect(
      reducePipeline(
        pipeline,
        {
          ...active,
          values: [value],
          nodes: [{ occurrence, state: 'terminal', outcome: 'failed' }],
        },
        replayInit,
      ),
    ).toMatchObject({
      ok: false,
      faults: [{ code: 'SNAPSHOT_OUTCOME', path: '/snapshot/nodes/0/outcome' }],
    });
  });

  test('owns missing, progressive, and contradictory gate-source evidence precisely', () => {
    const pipeline = compileSource('gate');
    const active = initialized(pipeline);
    const value = {
      fact: { key: 'value', value: 'recorded' },
      source: { kind: 'humanGateResolution' as const, occurrence },
    };
    expect(reducePipeline(pipeline, { ...active, values: [value] }, replayInit)).toMatchObject({
      ok: false,
      faults: [{ code: 'SNAPSHOT_RESOLUTION', path: '/snapshot/values/0/source' }],
    });
    const resolution = { occurrence, resolution: 'approved' };
    expect(
      reducePipeline(
        pipeline,
        { ...active, values: [value], gateResolutions: [resolution] },
        replayInit,
      ),
    ).toMatchObject({
      ok: false,
      faults: [{ code: 'SNAPSHOT_UNSETTLED', path: '/snapshot' }],
    });
    expect(
      reducePipeline(
        pipeline,
        {
          ...active,
          values: [value],
          nodes: [{ occurrence, state: 'terminal', outcome: 'rejected' }],
          gateResolutions: [resolution],
        },
        replayInit,
      ),
    ).toMatchObject({
      ok: false,
      faults: [{ code: 'SNAPSHOT_OUTCOME', path: '/snapshot/nodes/0/outcome' }],
    });
  });

  test('rejects duplicate node and gate-evidence identities at the later original index', () => {
    const pipeline = compileSource('gate');
    const active = initialized(pipeline);
    const node = active.nodes[0];
    if (!node) {
      throw new Error('source must be enabled');
    }
    expect(reducePipeline(pipeline, { ...active, nodes: [node, node] }, replayInit)).toMatchObject({
      ok: false,
      faults: [{ code: 'SNAPSHOT_DUPLICATE', path: '/snapshot/nodes/1' }],
    });
    const resolution = { occurrence, resolution: 'approved' };
    expect(
      reducePipeline(
        pipeline,
        { ...active, gateResolutions: [resolution, resolution] },
        replayInit,
      ),
    ).toMatchObject({
      ok: false,
      faults: [
        {
          code: 'SNAPSHOT_DUPLICATE',
          path: '/snapshot/gateResolutions/1/occurrence/nodeKey',
        },
      ],
    });
  });
});
