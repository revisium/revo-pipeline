import { afterEach, describe, expect, it, vi } from 'vitest';

import { advancePipeline, createInitialPipelineState } from '../../src/kernel/index.js';
import * as program from '../../src/program/index.js';
import type { ProgramNode } from '../../src/program/index.js';
import { kernelModule, kernelProgram, kernelRegion } from '../support/kernel-builders.js';
import { emptySchema } from '../support/source-builders.js';

const id = (ordinal: number) => `sha256:${ordinal.toString(16).padStart(64, '0')}` as const;

const maximumRunningProgram = () => {
  const nodes: ProgramNode[] = [];
  for (let ordinal = 1; ordinal <= 4_096; ordinal += 1) {
    const nodeId = id(ordinal);
    const next = id(ordinal + 1);
    if (ordinal === 1) {
      nodes.push({
        kind: 'activity',
        id: nodeId,
        activityKind: 'agent',
        requirementKey: 'pending',
        input: {},
        inputSchema: emptySchema(),
        outputSchema: emptySchema(),
        routes: { succeeded: next, failed: next, cancelled: next },
      });
    } else if (ordinal === 4_096) {
      nodes.push({ kind: 'end', id: nodeId, outcome: 'ok', output: {} });
    } else {
      nodes.push({
        kind: 'choice',
        id: nodeId,
        selector: { kind: 'literal', value: true },
        cases: [{ key: 'only', when: { kind: 'equals', value: true }, target: next }],
        otherwise: next,
      });
    }
  }
  const [first, ...rest] = nodes;
  if (first === undefined) {
    throw new TypeError('Expected maximum Program nodes.');
  }
  return kernelProgram([kernelModule('main', kernelRegion([first, ...rest]))]);
};

describe('runtime targeted Program access', () => {
  afterEach(() => vi.restoreAllMocks());

  it('admits a maximum Program once and never re-analyzes it across repeated events', () => {
    const admission = vi.spyOn(program, 'analyzeProgram');
    const bundle = maximumRunningProgram();
    const initial = createInitialPipelineState(bundle, {});
    const command = initial.commands.find(({ kind }) => kind === 'dispatchActivity');
    if (command?.kind !== 'dispatchActivity') {
      throw new TypeError('Expected the pending maximum-Program activity.');
    }
    expect(admission).toHaveBeenCalledTimes(1);
    for (let attempt = 0; attempt < 32; attempt += 1) {
      expect(
        advancePipeline(bundle, initial.state, {
          kind: 'signalReceived',
          commandKey: command.key,
          ref: command.ref,
          signal: 'wrong-kind',
          payload: null,
        }),
      ).toMatchObject({ kind: 'rejected', faults: [{ code: 'EVENT_OPERATION_KIND' }] });
    }
    expect(admission).toHaveBeenCalledTimes(1);
  });
});
