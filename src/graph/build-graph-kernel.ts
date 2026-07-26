import { compareUnicodeCodePoints, PIPELINE_LIMITS } from '../policy/index.js';
import type { GraphKernelBuild } from './graph-kernel-build.js';
import type { GraphKernelInput } from './graph-kernel-input.js';
import type { GraphKernel } from './graph-kernel.js';
import type { GraphOperationSink } from './graph-operation-sink.js';

const count = (sink: GraphOperationSink | undefined, kind: 'node' | 'edge', value = 1): void => {
  sink?.add(kind, value);
};

const frozenOffsets = (offsets: readonly number[]): readonly number[] =>
  Object.freeze([...offsets]);

export const buildGraphKernel = (
  input: GraphKernelInput,
  instrumentation?: GraphOperationSink,
): GraphKernelBuild => {
  const { edges, nodeKeys } = input;
  if (
    nodeKeys.length > PIPELINE_LIMITS.definition.nodes ||
    edges.length > PIPELINE_LIMITS.definition.edges
  ) {
    return { ok: false, reason: 'limit', offset: -1 };
  }

  const offsets = new Map<string, number>();
  for (let offset = 0; offset < nodeKeys.length; offset += 1) {
    const key = nodeKeys[offset];
    count(instrumentation, 'node');
    if (
      key === undefined ||
      (offset > 0 && compareUnicodeCodePoints(nodeKeys[offset - 1] ?? '', key) >= 0)
    ) {
      return { ok: false, reason: 'node-order', offset };
    }
    offsets.set(key, offset);
  }

  const incoming = Array.from({ length: nodeKeys.length }, () => [] as number[]);
  const outgoing = Array.from({ length: nodeKeys.length }, () => [] as number[]);
  const edgeFromOffsets: number[] = [];
  const edgeToOffsets: number[] = [];
  for (let offset = 0; offset < edges.length; offset += 1) {
    const edge = edges[offset];
    count(instrumentation, 'edge');
    const from = edge && offsets.get(edge.from);
    const to = edge && offsets.get(edge.to);
    if (from === undefined || to === undefined) {
      return { ok: false, reason: 'foreign-edge', offset };
    }
    edgeFromOffsets.push(from);
    edgeToOffsets.push(to);
    outgoing[from]?.push(offset);
    incoming[to]?.push(offset);
  }

  const nodeOffset = (key: string): number | undefined => offsets.get(key);
  const kernel: GraphKernel = Object.freeze({
    nodeKeys: Object.freeze([...nodeKeys]),
    edgeFromOffsets: frozenOffsets(edgeFromOffsets),
    edgeToOffsets: frozenOffsets(edgeToOffsets),
    incomingEdgeOffsets: Object.freeze(incoming.map(frozenOffsets)),
    outgoingEdgeOffsets: Object.freeze(outgoing.map(frozenOffsets)),
    nodeOffset,
  });
  return { ok: true, kernel };
};
