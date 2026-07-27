import { buildGraphKernel } from '../../graph/index.js';
import { compareSerializedGraph } from './compare-serialized-graph.js';
import { deriveExpectedCompiledSemantics } from './derive-expected-compiled-semantics.js';
import type { HostileCompiledValidation } from './hostile-compiled-validation.js';
import { precheckCompiledBounds } from './precheck-compiled-bounds.js';
import { snapshotCompiledInput } from './snapshot-compiled-input.js';
import { validateCompiledMembers } from './validate-compiled-members.js';
import { verifySerializedIndexes } from './verify-serialized-indexes.js';
import { verifySerializedTopology } from './verify-serialized-topology.js';

export const validateCompiledInternally = (input: unknown): HostileCompiledValidation => {
  if (!precheckCompiledBounds(input)) {
    return { ok: false };
  }
  const snapshot = snapshotCompiledInput(input);
  if (snapshot === undefined || !validateCompiledMembers(snapshot)) {
    return { ok: false };
  }
  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);
  if (expected === undefined || !compareSerializedGraph(snapshot, expected)) {
    return { ok: false };
  }
  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });
  if (!built.ok) {
    return { ok: false };
  }
  const kernel = built.kernel;
  const topologicalOffsets = verifySerializedTopology(snapshot, kernel);
  if (topologicalOffsets === undefined || !verifySerializedIndexes(snapshot, kernel)) {
    return { ok: false };
  }
  return Object.freeze({ ok: true, snapshot, kernel, topologicalOffsets });
};
