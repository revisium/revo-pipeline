import { buildGraphKernel } from '../graph/index.js';
import { compareSerializedGraph } from './compiled/compare-serialized-graph.js';
import { CompiledInspectionFaultCollector } from './compiled/compiled-inspection-fault-collector.js';
import type { CompiledInspection } from './compiled/compiled-inspection.js';
import { deriveExpectedCompiledSemantics } from './compiled/derive-expected-compiled-semantics.js';
import { inspectCompiledMembers } from './compiled/inspect-compiled-members.js';
import { snapshotCompiledInput } from './compiled/snapshot-compiled-input.js';
import { verifySerializedIndexes } from './compiled/verify-serialized-indexes.js';
import { verifySerializedTopology } from './compiled/verify-serialized-topology.js';

const failed = (
  code: 'DECODE_TYPE' | 'DECODE_LIMIT' | 'DECODE_SCHEMA' | 'DECODE_GRAPH' | 'DECODE_CANONICAL',
  path: string,
  message: string,
): CompiledInspection => {
  const faults = new CompiledInspectionFaultCollector();
  faults.add({ code, path, message });
  return { ok: false, faults: faults.finish() };
};

export const inspectCompiledPipeline = (input: unknown): CompiledInspection => {
  const captureFaults = new CompiledInspectionFaultCollector();
  const snapshot = snapshotCompiledInput(input, captureFaults);
  if (captureFaults.hasFaults || snapshot === undefined) {
    return { ok: false, faults: captureFaults.finish() };
  }
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    return failed('DECODE_TYPE', '', 'Compiled pipeline value is not portable data.');
  }
  const memberFaults = new CompiledInspectionFaultCollector();
  if (!inspectCompiledMembers(snapshot, memberFaults)) {
    return { ok: false, faults: memberFaults.finish() };
  }
  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);
  if (expected === undefined) {
    return failed('DECODE_GRAPH', '/nodes', 'Compiled pipeline graph is invalid.');
  }
  const graphMismatchPath = compareSerializedGraph(snapshot, expected);
  if (graphMismatchPath !== null) {
    return failed(
      'DECODE_CANONICAL',
      graphMismatchPath,
      'Compiled pipeline derived data is not canonical.',
    );
  }
  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });
  if (!built.ok) {
    return failed('DECODE_GRAPH', '/edges', 'Compiled pipeline graph is invalid.');
  }
  const kernel = built.kernel;
  const topology = verifySerializedTopology(snapshot, kernel);
  if (!topology.ok) {
    return failed(topology.code, topology.path, topology.message);
  }
  const topologicalOffsets = topology.offsets;
  const indexMismatchPath = verifySerializedIndexes(snapshot, kernel);
  if (indexMismatchPath !== null) {
    return failed(
      'DECODE_CANONICAL',
      indexMismatchPath,
      'Compiled pipeline index is not canonical.',
    );
  }
  return Object.freeze({
    ok: true,
    snapshot,
    kernel,
    topologicalOffsets,
  });
};
