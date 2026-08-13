import { describe, expect, it } from 'vitest';

import type {
  NodeTerminalResult,
  PipelineState,
  RootRegionMachineFrame,
} from '../../src/kernel/index.js';
import type { ProgramNodeId } from '../../src/program/index.js';
import { hydratePipelineState, insertCanonicalNodeResult } from '../support/kernel-internal.js';

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

type Measurement = {
  readonly cpuMs: number;
  readonly wallMs: number;
  readonly rssDeltaBytes: number;
  readonly maxRssKilobytes: number;
};

const measure = (run: () => unknown): Measurement => {
  const started = process.cpuUsage();
  const wallStarted = performance.now();
  const rssStarted = process.memoryUsage().rss;
  run();
  const elapsed = process.cpuUsage(started);
  return {
    cpuMs: (elapsed.user + elapsed.system) / 1_000,
    wallMs: performance.now() - wallStarted,
    rssDeltaBytes: process.memoryUsage().rss - rssStarted,
    maxRssKilobytes: process.resourceUsage().maxRSS,
  };
};

const median = (values: readonly number[]): number =>
  values.toSorted((left, right) => left - right)[Math.floor(values.length / 2)] ?? Infinity;

describe('kernel state performance', () => {
  it('reports maximum live result checkpoint telemetry within generous guardrails', () => {
    completeNodeResults();
    const insertion = Array.from({ length: 5 }, () => measure(completeNodeResults));

    const nodeResults = completeNodeResults();
    const state = stateWithResults(nodeResults);
    hydratePipelineState(state);
    JSON.stringify(state);
    const hydration = Array.from({ length: 5 }, () => measure(() => hydratePipelineState(state)));
    const serialization = Array.from({ length: 5 }, () => measure(() => JSON.stringify(state)));
    const measurements = [...insertion, ...hydration, ...serialization];
    const report = {
      insertionCpuMedianMs: median(insertion.map(({ cpuMs }) => cpuMs)),
      insertionWallMedianMs: median(insertion.map(({ wallMs }) => wallMs)),
      hydrationCpuMedianMs: median(hydration.map(({ cpuMs }) => cpuMs)),
      hydrationWallMedianMs: median(hydration.map(({ wallMs }) => wallMs)),
      serializationCpuMedianMs: median(serialization.map(({ cpuMs }) => cpuMs)),
      serializationWallMedianMs: median(serialization.map(({ wallMs }) => wallMs)),
      maxRssKilobytes: Math.max(...measurements.map(({ maxRssKilobytes }) => maxRssKilobytes)),
      peakAbsoluteRssDeltaBytes: Math.max(
        ...measurements.map(({ rssDeltaBytes }) => Math.abs(rssDeltaBytes)),
      ),
    };
    process.stdout.write(`[performance-telemetry] ${JSON.stringify(report)}\n`);

    expect(report.insertionCpuMedianMs).toBeLessThanOrEqual(5_000);
    expect(report.hydrationCpuMedianMs).toBeLessThanOrEqual(500);
    expect(report.serializationCpuMedianMs).toBeLessThanOrEqual(50);
    expect(report.insertionWallMedianMs).toBeLessThanOrEqual(10_000);
    expect(report.hydrationWallMedianMs).toBeLessThanOrEqual(2_000);
    expect(report.serializationWallMedianMs).toBeLessThanOrEqual(500);
    expect(report.maxRssKilobytes).toBeLessThanOrEqual(2_000_000);
    expect(report.peakAbsoluteRssDeltaBytes).toBeLessThanOrEqual(1_000_000_000);
  }, 60_000);
});
