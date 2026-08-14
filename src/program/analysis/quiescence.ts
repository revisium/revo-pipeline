import { localTargets as programNodeTargets } from '../admission/graphs.js';
import type { ProgramNode, ProgramNodeId, ProgramRegion } from '../contracts/index.js';
import { PROGRAM_ADMISSION_LIMITS } from './limits.js';

export type WorkEnvelope = {
  readonly start: number;
  readonly resume: number;
  readonly cancel: number;
  readonly tokens: number;
  readonly synchronous: number | null;
};

const overflow = Number.MAX_SAFE_INTEGER;
const add = (...values: readonly number[]): number =>
  Math.min(
    overflow,
    values.reduce((total, value) => total + value, 0),
  );
const multiply = (value: number, count: number): number => {
  if (value === 0 || count === 0) {
    return 0;
  }
  if (value > Math.floor(overflow / count)) {
    return overflow;
  }
  return Math.min(overflow, value * count);
};

const emptyEnvelope = (): WorkEnvelope =>
  Object.freeze({ start: 0, resume: 0, cancel: 0, tokens: 0, synchronous: 0 });

const maximumEnvelope = (envelopes: readonly WorkEnvelope[]): WorkEnvelope => {
  if (envelopes.length === 0) {
    return emptyEnvelope();
  }
  const allSynchronous = envelopes.every(({ synchronous }) => synchronous !== null);
  return Object.freeze({
    start: Math.max(...envelopes.map(({ start }) => start)),
    resume: Math.max(...envelopes.map(({ resume }) => resume)),
    cancel: Math.max(...envelopes.map(({ cancel }) => cancel)),
    tokens: Math.max(...envelopes.map(({ tokens }) => tokens)),
    synchronous: allSynchronous
      ? Math.max(...envelopes.map(({ synchronous }) => synchronous ?? 0))
      : null,
  });
};

type RegionAnalysisContext = {
  readonly moduleWork: ReadonlyMap<string, WorkEnvelope>;
  readonly analyseRegion: (region: ProgramRegion) => WorkEnvelope;
};

const structuredCompletion = (continuation: WorkEnvelope): number => add(4, continuation.start);

const externalNode = (continuations: readonly WorkEnvelope[]): WorkEnvelope => {
  const continuation = maximumEnvelope(continuations);
  return Object.freeze({
    start: 3,
    resume: add(2, continuation.start),
    cancel: add(2, continuation.cancel),
    tokens: Math.max(1, continuation.tokens),
    synchronous: null,
  });
};

const callNode = (
  node: Extract<ProgramNode, { readonly kind: 'call' }>,
  continuations: readonly WorkEnvelope[],
  context: RegionAnalysisContext,
): WorkEnvelope => {
  const called = context.moduleWork.get(node.module) ?? emptyEnvelope();
  const continuation = maximumEnvelope(continuations);
  return Object.freeze({
    start: add(3, called.start),
    resume: add(called.resume, structuredCompletion(continuation)),
    cancel: add(called.cancel, 4),
    tokens: Math.max(called.tokens, continuation.tokens),
    synchronous:
      called.synchronous === null
        ? null
        : add(3, called.synchronous, structuredCompletion(continuation)),
  });
};

const parallelNode = (
  node: Extract<ProgramNode, { readonly kind: 'parallel' }>,
  continuation: WorkEnvelope,
  context: RegionAnalysisContext,
): WorkEnvelope => {
  const branches = node.branches.map(({ region }) => context.analyseRegion(region));
  const branchStarts = branches.reduce((total, branch) => add(total, 1, branch.start), 0);
  const branchResumes = branches.map(({ resume }) => resume);
  const synchronous = branches.every((branch) => branch.synchronous !== null)
    ? add(2, ...branches.map((branch) => add(1, branch.synchronous ?? 0, 2)), continuation.start)
    : null;
  const tokens = branches.reduce((total, branch) => total + branch.tokens, 0);
  const cancelOverlay = node.remaining === 'cancel' ? add(2, tokens * 2) : 0;
  return Object.freeze({
    start: Math.max(add(2, branchStarts), synchronous ?? 0),
    resume: add(Math.max(0, ...branchResumes), 4, continuation.start),
    cancel: add(cancelOverlay, Math.max(0, ...branches.map(({ cancel }) => cancel)), 4),
    tokens,
    synchronous,
  });
};

const repeatNode = (
  node: Extract<ProgramNode, { readonly kind: 'repeat' }>,
  continuation: WorkEnvelope,
  context: RegionAnalysisContext,
): WorkEnvelope => {
  const body = context.analyseRegion(node.body);
  const cycle = add(3, body.synchronous ?? 0);
  const synchronous =
    body.synchronous === null
      ? null
      : add(2, multiply(cycle, node.maximumIterations), continuation.start);
  return Object.freeze({
    start: Math.max(add(2, body.start), synchronous ?? 0),
    resume: add(body.resume, 4, body.start, continuation.start),
    cancel: add(body.cancel, 4),
    tokens: Math.max(body.tokens, continuation.tokens),
    synchronous,
  });
};

const mapNode = (
  node: Extract<ProgramNode, { readonly kind: 'map' }>,
  continuation: WorkEnvelope,
  context: RegionAnalysisContext,
): WorkEnvelope => {
  const body = context.analyseRegion(node.body);
  const liveItems = Math.min(node.maximumItems, node.maximumConcurrency);
  const liveStart = multiply(add(1, body.start), liveItems);
  const terminalItem = add(1, body.synchronous ?? 0, 3);
  const synchronous =
    body.synchronous === null
      ? null
      : add(2, node.maximumItems, multiply(terminalItem, node.maximumItems), continuation.start);
  const tokens = Math.min(
    PROGRAM_ADMISSION_LIMITS.liveOperations + 1,
    liveItems * Math.max(1, body.tokens),
  );
  const stopAndTotalize = add(node.maximumItems - liveItems, 2);
  const cancelOverlay =
    node.failure.kind === 'failFast' && node.failure.remaining === 'cancel'
      ? add(2, tokens * 2)
      : 0;
  return Object.freeze({
    start: Math.max(add(2, node.maximumItems, liveStart), synchronous ?? 0),
    resume: add(body.resume, 4, body.start, stopAndTotalize, continuation.start),
    cancel: add(body.cancel, cancelOverlay, stopAndTotalize, 4),
    tokens,
    synchronous,
  });
};

const nodeEnvelope = (
  node: ProgramNode,
  continuations: readonly WorkEnvelope[],
  context: RegionAnalysisContext,
): WorkEnvelope => {
  const continuation = maximumEnvelope(continuations);
  switch (node.kind) {
    case 'activity':
    case 'wait':
    case 'humanGate':
      return externalNode(continuations);
    case 'choice':
      return Object.freeze({
        start: add(1, continuation.start),
        resume: continuation.resume,
        cancel: continuation.cancel,
        tokens: continuation.tokens,
        synchronous: continuation.synchronous === null ? null : add(1, continuation.synchronous),
      });
    case 'call':
      return callNode(node, continuations, context);
    case 'parallel':
      return parallelNode(node, continuation, context);
    case 'repeat':
      return repeatNode(node, continuation, context);
    case 'map':
      return mapNode(node, continuation, context);
    case 'end':
      return Object.freeze({ start: 2, resume: 0, cancel: 0, tokens: 0, synchronous: 2 });
  }
  node satisfies never;
  throw new TypeError('Unexpected Program node kind.');
};

const topologicalNodeOrder = (region: ProgramRegion): readonly ProgramNode[] => {
  const nodes = new Map(region.nodes.map((node) => [node.id, node]));
  const indegree = new Map<ProgramNodeId, number>(region.nodes.map((node) => [node.id, 0]));
  for (const node of region.nodes) {
    for (const target of programNodeTargets(node)) {
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  const ordered: ProgramNode[] = [];
  while (ready.length > 0) {
    const id = ready.pop();
    const node = id === undefined ? undefined : nodes.get(id);
    if (node === undefined) {
      continue;
    }
    ordered.push(node);
    for (const target of programNodeTargets(node)) {
      const count = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, count);
      if (count === 0) {
        ready.push(target);
      }
    }
  }
  return ordered;
};

export const analyseRegionWork = (
  region: ProgramRegion,
  moduleWork: ReadonlyMap<string, WorkEnvelope>,
): WorkEnvelope => {
  const cache = new Map<ProgramNodeId, WorkEnvelope>();
  const analyseRegion = (child: ProgramRegion): WorkEnvelope =>
    analyseRegionWork(child, moduleWork);
  const context: RegionAnalysisContext = { moduleWork, analyseRegion };
  for (const node of topologicalNodeOrder(region).toReversed()) {
    const continuations = programNodeTargets(node).flatMap((target) => {
      const envelope = cache.get(target);
      return envelope === undefined ? [] : [envelope];
    });
    cache.set(node.id, nodeEnvelope(node, continuations, context));
  }
  return cache.get(region.entry) ?? emptyEnvelope();
};
