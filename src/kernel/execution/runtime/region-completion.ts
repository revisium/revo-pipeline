import type { Digest, JsonPointer, PipelineFailure } from '../../../foundation/index.js';
import type { ProgramEndNode } from '../../../program/index.js';
import type { RegionMachineFrame } from '../../contracts/region-frames.js';
import type { RegionTerminalResult } from '../../contracts/results.js';
import { resolveMapping, valueMatchesSchema } from '../selectors.js';
import { completeCallRegion } from './call-completion.js';
import type { RequestedCleanup, RuntimeContext } from './context.js';
import { selectorEnvironmentFor } from './environment.js';
import { completeMapItem } from './map-completion.js';
import { completeParallelBranch } from './parallel-completion.js';
import { resolveRuntimeRegion } from './program-index.js';
import { completeRepeatBody } from './repeat-completion.js';
import { failure } from './results.js';

const failedRegion = (code: string, path: JsonPointer = ''): RegionTerminalResult =>
  Object.freeze({ status: 'failed', failure: failure(code, path) });

const resultForEnd = (
  context: RuntimeContext,
  frame: RegionMachineFrame,
  node: ProgramEndNode,
): RegionTerminalResult => {
  const region = resolveRuntimeRegion(frame.key, context.draft, context.index);
  const environment = region === null ? null : selectorEnvironmentFor(region, context);
  if (region === null || environment === null) {
    return failedRegion('INVARIANT_PROGRAM_STATE');
  }
  const output = resolveMapping(node.output, environment);
  if (!output.ok) {
    return failedRegion('DATA_POINTER_MISSING', output.path);
  }
  const exit = region.region.exits.find(({ outcome }) => outcome === node.outcome);
  if (
    exit === undefined ||
    !valueMatchesSchema(exit.outputSchema, output.value) ||
    !valueMatchesSchema(region.region.outputSchema, output.value)
  ) {
    return failedRegion('DATA_SCHEMA_MISMATCH');
  }
  return Object.freeze({ status: 'succeeded', outcome: node.outcome, output: output.value });
};

export const completeRegion = (
  context: RuntimeContext,
  frame: RegionMachineFrame,
  node: ProgramEndNode,
): boolean => {
  const result = resultForEnd(context, frame, node);
  const cancellation = context.cancellationFor(frame.key);
  if (frame.kind === 'rootRegion') {
    if (result.status === 'succeeded') {
      context.selectTerminal({ kind: 'succeeded', outcome: result.outcome, output: result.output });
    } else if (result.status === 'failed') {
      context.selectTerminal({ kind: 'failed', failure: result.failure });
    } else {
      return false;
    }
    return true;
  }
  switch (frame.kind) {
    case 'callRegion':
      return completeCallRegion(context, frame, result, cancellation);
    case 'parallelBranch':
      return completeParallelBranch(context, frame, result, cancellation);
    case 'repeatBody':
      return completeRepeatBody(context, frame, result, cancellation);
    case 'mapItem':
      return completeMapItem(context, frame, result, cancellation);
  }
  frame satisfies never;
  return false;
};

export const completeRequestedCancellation = (
  context: RuntimeContext,
  frameKey: Digest,
  result: RegionTerminalResult,
  cleanup: RequestedCleanup,
): boolean => {
  const frame = context.draft.frames.get(frameKey);
  if (frame === undefined || !('regionId' in frame)) {
    return false;
  }
  if (frame.kind === 'rootRegion') {
    return cleanup.run && context.draft.getRunCancellation() !== null;
  }
  switch (frame.kind) {
    case 'callRegion':
      return completeCallRegion(context, frame, result, cleanup);
    case 'parallelBranch':
      return completeParallelBranch(context, frame, result, cleanup);
    case 'repeatBody':
      return completeRepeatBody(context, frame, result, cleanup);
    case 'mapItem':
      return completeMapItem(context, frame, result, cleanup);
  }
  frame satisfies never;
  return false;
};

export const completeFailedRegion = (
  context: RuntimeContext,
  frame: RegionMachineFrame,
  value: PipelineFailure,
): boolean => {
  if (frame.kind === 'rootRegion') {
    context.selectTerminal({ kind: 'failed', failure: value });
    return true;
  }
  const result: RegionTerminalResult = Object.freeze({ status: 'failed', failure: value });
  switch (frame.kind) {
    case 'callRegion':
      return completeCallRegion(context, frame, result);
    case 'parallelBranch':
      return completeParallelBranch(context, frame, result);
    case 'repeatBody':
      return completeRepeatBody(context, frame, result);
    case 'mapItem':
      return completeMapItem(context, frame, result);
  }
  frame satisfies never;
  return false;
};
