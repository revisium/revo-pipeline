import { describe, expect, test } from 'vitest';

import {
  compilePipeline,
  reducePipeline,
  type PipelineDefinition,
  type PipelineSnapshot,
} from '../../../src/index.js';

const initial = (): PipelineSnapshot => ({
  schemaVersion: 1,
  occurrenceKey: 'limit-run',
  phase: 'uninitialized',
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
  terminal: null,
});

const terminalChain = () => {
  const branches: PipelineDefinition['nodes'][number][] = Array.from(
    { length: 255 },
    (_, index) => {
      const key = `branch-${String(index).padStart(3, '0')}`;
      const next = index === 254 ? 'end' : `branch-${String(index + 1).padStart(3, '0')}`;
      return {
        kind: 'branch',
        key,
        fact: 'continue',
        cases: [{ name: 'yes', when: { op: 'equals', value: true }, to: next }],
        default: { name: 'no', to: next },
      };
    },
  );
  const result = compilePipeline({
    schemaVersion: 1,
    entry: 'branch-000',
    facts: [{ key: 'continue', type: 'boolean' }],
    nodes: [...branches, { kind: 'terminal', key: 'end', outcome: 'done' }],
  });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.faults));
  }
  return result.pipeline;
};

const consensusChain = () => {
  const definition: PipelineDefinition = {
    schemaVersion: 1,
    entry: 'vote',
    facts: [{ key: 'continue', type: 'boolean' }],
    nodes: [
      {
        kind: 'consensus',
        key: 'vote',
        candidates: ['candidate'],
        policy: { kind: 'unanimous' },
        outcomes: {
          approved: 'branch-000',
          insufficient: 'branch-000',
          rejected: 'branch-000',
          tied: 'branch-000',
        },
      },
      ...Array.from({ length: 254 }, (_, index) => ({
        kind: 'branch' as const,
        key: `branch-${String(index).padStart(3, '0')}`,
        fact: 'continue',
        cases: [
          {
            name: 'yes',
            when: { op: 'equals' as const, value: true },
            to: index === 253 ? 'end' : `branch-${String(index + 1).padStart(3, '0')}`,
          },
        ],
        default: {
          name: 'no',
          to: index === 253 ? 'end' : `branch-${String(index + 1).padStart(3, '0')}`,
        },
      })),
      { kind: 'terminal', key: 'end', outcome: 'done' },
    ],
  };
  const result = compilePipeline(definition);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.faults));
  }
  return result.pipeline;
};

describe('reducePipeline effect frontiers', () => {
  test('produces exactly 512 effects from a maximum-size consensus chain', () => {
    const initialized = reducePipeline(consensusChain(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [{ key: 'continue', value: true }],
    });
    if (!initialized.ok) {
      throw new Error('consensus chain initialization must succeed');
    }
    const reduced = reducePipeline(consensusChain(), initialized.snapshot, {
      schemaVersion: 1,
      kind: 'consensusVerdict',
      occurrence: { occurrenceKey: 'limit-run', nodeKey: 'vote' },
      candidate: 'candidate',
      verdict: 'approve',
    });
    expect(reduced).toMatchObject({ ok: true, status: 'terminal' });
    const items = reduced.ok ? reduced.batch.items : [];
    const kinds = items.map((effect) => effect.kind);
    const selectorApplications = kinds.filter((kind) => kind === 'completeSelector').length;
    const terminalApplications = kinds.filter((kind) => kind === 'terminatePipeline').length;
    expect(selectorApplications + terminalApplications).toBe(256);
    expect(kinds).toEqual([
      'recordConsensusVerdict',
      ...Array.from({ length: 255 }, () => ['completeSelector', 'activateNode']).flat(),
      'terminatePipeline',
    ]);
    expect(items).toHaveLength(512);
  });

  test('produces exactly 513 effects before maximum-size terminal closure', () => {
    const reduced = reducePipeline(terminalChain(), initial(), {
      schemaVersion: 1,
      kind: 'init',
      values: [{ key: 'continue', value: true }],
    });
    expect(reduced).toMatchObject({ ok: true, status: 'terminal' });
    const items = reduced.ok ? reduced.batch.items : [];
    const kinds = items.map((effect) => effect.kind);
    const selectorApplications = kinds.filter((kind) => kind === 'completeSelector').length;
    const terminalApplications = kinds.filter((kind) => kind === 'terminatePipeline').length;
    const entryApplication = kinds[0] === 'initialize' && kinds[1] === 'activateNode' ? 1 : 0;
    expect(entryApplication + selectorApplications + terminalApplications).toBe(257);
    expect(kinds).toEqual([
      'initialize',
      'activateNode',
      ...Array.from({ length: 255 }, () => ['completeSelector', 'activateNode']).flat(),
      'terminatePipeline',
    ]);
    expect(items).toHaveLength(513);
  });
});
