import { describe, expect, it } from 'vitest';

import type {
  NodeTerminalResult,
  PipelineState,
  RootRegionMachineFrame,
} from '../../src/kernel/index.js';
import type { ProgramModule, ProgramNode, ProgramNodeId } from '../../src/program/index.js';
import { kernelModule, kernelProgram, kernelRegion } from '../support/kernel-builders.js';
import { activityDispatch, boundaryResult } from '../support/kernel-builders.js';
import {
  advanceBaseKernel,
  findModule,
  findNode,
  initializeBaseKernel,
  inspectKernelProgram,
  hydratePipelineState,
  insertCanonicalNodeResult,
  resolveBaseRegion,
  type LookupCounters,
  type ProgramValidationCounters,
} from '../support/kernel-internal.js';
import { emptySchema } from '../support/source-builders.js';

const digestFromNumber = (value: number): ProgramNodeId =>
  `sha256:${value.toString(16).padStart(64, '0')}`;

const completeNodeResults = (): RootRegionMachineFrame['nodeResults'] => {
  let results: Readonly<Record<ProgramNodeId, NodeTerminalResult>> = Object.freeze({});
  for (let ordinal = 4_096; ordinal > 0; ordinal -= 1) {
    const inserted = insertCanonicalNodeResult(
      results,
      digestFromNumber(ordinal),
      Object.freeze({ status: 'succeeded', output: ordinal }),
    );
    if (inserted === null) {
      throw new TypeError('Expected a unique performance-fixture result.');
    }
    results = inserted;
  }
  return results;
};

const stateWithResults = (nodeResults: RootRegionMachineFrame['nodeResults']): PipelineState => ({
  schemaVersion: 'pipeline-state/v1',
  programDigest: digestFromNumber(90_000),
  status: 'running',
  input: {},
  frames: [
    {
      kind: 'rootRegion',
      key: digestFromNumber(90_001),
      parentFrameKey: null,
      scopeInput: {},
      nodeResults,
      regionId: digestFromNumber(90_002),
      status: 'active',
      ready: [digestFromNumber(90_003)],
      selectedExit: null,
    },
  ],
  pending: [],
  resolved: [],
  runCancellation: null,
  regionCancellations: [],
  result: null,
  fault: null,
});

const measure = <Value>(run: () => Value): { readonly elapsed: number; readonly value: Value } => {
  const started = performance.now();
  const value = run();
  return { elapsed: performance.now() - started, value };
};

const median = (values: readonly number[]): number =>
  values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)] ?? Infinity;

const nonEmpty = <Value>(values: readonly Value[]): [Value, ...Value[]] => {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new TypeError('Expected a non-empty collection.');
  }
  return [first, ...rest];
};

const structuralProgram = () => {
  const modules: ProgramModule[] = [];
  for (let moduleIndex = 0; moduleIndex < 64; moduleIndex += 1) {
    const nodes: ProgramNode[] = [];
    for (let nodeIndex = 0; nodeIndex < 64; nodeIndex += 1) {
      const ordinal = moduleIndex * 64 + nodeIndex + 1;
      if (nodeIndex === 63) {
        nodes.push({ kind: 'end', id: digestFromNumber(ordinal), outcome: 'ok', output: {} });
        continue;
      }
      const target = digestFromNumber(ordinal + 1);
      const caseCount = nodeIndex === 0 ? 7 : 3;
      const cases = nonEmpty(
        Array.from({ length: caseCount }, (_, index) => ({
          key: String.fromCharCode(97 + index),
          when: { kind: 'equals' as const, value: index },
          target,
        })),
      );
      nodes.push({
        kind: 'choice',
        id: digestFromNumber(ordinal),
        selector: { kind: 'literal', value: true },
        cases,
        otherwise: target,
      });
    }
    const sorted = nodes.toSorted((left, right) => left.id.localeCompare(right.id));
    const [first, ...rest] = sorted;
    if (first === undefined) {
      throw new TypeError('Expected structural nodes.');
    }
    modules.push(
      kernelModule(
        `module-${String(moduleIndex).padStart(2, '0')}`,
        kernelRegion([first, ...rest], { id: digestFromNumber(50_000 + moduleIndex) }),
      ),
    );
  }
  const [first, ...rest] = modules;
  if (first === undefined) {
    throw new TypeError('Expected structural modules.');
  }
  return kernelProgram([first, ...rest]);
};

const depth32Program = () => {
  const modules: ProgramModule[] = [];
  for (let depth = 0; depth <= 32; depth += 1) {
    const nodeId = digestFromNumber(100_000 + depth * 3);
    const endId = digestFromNumber(100_001 + depth * 3);
    const end = { kind: 'end' as const, id: endId, outcome: 'ok', output: {} };
    const node: ProgramNode =
      depth === 32
        ? {
            kind: 'activity',
            id: nodeId,
            activityKind: 'agent',
            requirementKey: 'agent',
            input: {},
            inputSchema: emptySchema(),
            outputSchema: emptySchema(),
            routes: { succeeded: endId, failed: endId, cancelled: endId },
          }
        : {
            kind: 'call',
            id: nodeId,
            module: `depth-${String(depth + 1).padStart(2, '0')}`,
            input: {},
            outputSchema: emptySchema(),
            routes: {
              outcomes: [{ outcome: 'ok', target: endId }],
              failed: endId,
              cancelled: endId,
            },
          };
    modules.push(
      kernelModule(
        `depth-${String(depth).padStart(2, '0')}`,
        kernelRegion([node, end], { id: digestFromNumber(200_000 + depth) }),
      ),
    );
  }
  const [first, ...rest] = modules;
  if (first === undefined) {
    throw new TypeError('Expected depth modules.');
  }
  return kernelProgram([first, ...rest], 'depth-00');
};

describe('kernel structural performance', () => {
  it('validates 64 modules, 4096 nodes, and 16384 targets without activity-bound allocation', () => {
    const bundle = structuralProgram();
    const counters: ProgramValidationCounters = {
      classificationExitInspections: 0,
      modules: 0,
      regions: 0,
      nodes: 0,
      targets: 0,
    };

    const inspection = inspectKernelProgram(bundle, counters);

    expect(inspection.ok).toBe(true);
    expect(counters).toEqual({
      classificationExitInspections: 0,
      modules: 64,
      regions: 64,
      nodes: 4096,
      targets: 16_384,
    });
    expect(bundle.program.maximumTotalActivities).toBe(1_000_000);
  });

  it('uses logarithmic module and node lookup comparisons', () => {
    const bundle = structuralProgram();
    const counters: LookupCounters = { comparisons: 0, ancestrySteps: 0 };
    const module = findModule(bundle, 'module-63', counters);
    expect(module).not.toBeNull();
    if (module === null) {
      return;
    }
    expect(findNode(module.region, digestFromNumber(4096), counters)).not.toBeNull();
    expect(counters.comparisons).toBeLessThanOrEqual(14);
    expect(counters.ancestrySteps).toBe(0);
  });

  it('bounds a depth-32 event lookup and avoids rescanning unrelated Program nodes', () => {
    const bundle = depth32Program();
    const initial = boundaryResult(initializeBaseKernel(bundle, {}));
    const command = activityDispatch(initial);
    const lookupCounters: LookupCounters = { comparisons: 0, ancestrySteps: 0 };

    expect(
      resolveBaseRegion(bundle, initial.state, command.ref.frameKey, lookupCounters),
    ).not.toBeNull();
    expect(lookupCounters.ancestrySteps).toBe(32);
    expect(lookupCounters.comparisons).toBeLessThanOrEqual(520);
    expect(initial.state.frames).toHaveLength(65);
    expect(
      initial.state.frames.every(({ nodeResults }) => Object.keys(nodeResults).length === 0),
    ).toBe(true);
    expect(initial.state.pending).toHaveLength(1);

    const advanceCounters: LookupCounters = { comparisons: 0, ancestrySteps: 0 };
    const result = advanceBaseKernel(
      bundle,
      initial.state,
      {
        kind: 'activitySucceeded',
        commandKey: command.key,
        ref: command.ref,
        output: {},
      },
      advanceCounters,
    );

    expect(result.kind).toBe('terminal');
    expect(advanceCounters.ancestrySteps).toBe(32);
    expect(advanceCounters.comparisons).toBeLessThanOrEqual(1_500);
  });

  it('keeps maximum live result checkpoints within the reference timing guardrails', () => {
    completeNodeResults();
    const insertionTimes = Array.from({ length: 5 }, () => measure(completeNodeResults).elapsed);

    const nodeResults = completeNodeResults();
    const state = stateWithResults(nodeResults);
    hydratePipelineState(state);
    JSON.stringify(state);
    const hydrationTimes = Array.from(
      { length: 5 },
      () => measure(() => hydratePipelineState(state)).elapsed,
    );
    const serializationTimes = Array.from(
      { length: 5 },
      () => measure(() => JSON.stringify(state)).elapsed,
    );

    expect(median(insertionTimes)).toBeLessThanOrEqual(5_000);
    expect(median(hydrationTimes)).toBeLessThanOrEqual(500);
    expect(median(serializationTimes)).toBeLessThanOrEqual(50);
  }, 60_000);
});
