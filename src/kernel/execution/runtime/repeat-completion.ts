import type { JsonValue, PipelineFailure } from '../../../foundation/index.js';
import type { ProgramRepeatNode } from '../../../program/index.js';
import type { RepeatBodyMachineFrame } from '../../contracts/region-frames.js';
import type { NodeTerminalResult, RegionTerminalResult } from '../../contracts/results.js';
import type { RepeatMachineFrame } from '../../contracts/structured-frames.js';
import { resolveMapping, valueMatchesSchema, type SelectorEnvironment } from '../selectors.js';
import { pruneFrameTree } from './cancellation.js';
import type { CancellationCausality, RuntimeContext } from './context.js';
import { selectorEnvironmentFor } from './environment.js';
import { routeOwnedResult, storeOwnedResult } from './parent-result.js';
import { findRuntimeNode, resolveRuntimeRegion } from './program-index.js';
import { createRepeatBodyFrame } from './region-frames.js';
import { evaluateRepeatCondition } from './repeat-condition.js';
import {
  cancelledNode,
  cleanupNodeResult,
  failedNode,
  failure,
  readPipelineFailure,
  succeededNode,
} from './results.js';

const ownerNode = (
  context: RuntimeContext,
  owner: RepeatMachineFrame,
): ProgramRepeatNode | null => {
  const region = resolveRuntimeRegion(owner.parentFrameKey, context.draft, context.index);
  const node = region === null ? null : findRuntimeNode(context.index, region.region, owner.nodeId);
  return node?.kind === 'repeat' ? node : null;
};

const parentEnvironment = (
  context: RuntimeContext,
  owner: RepeatMachineFrame,
): SelectorEnvironment | null => {
  const region = resolveRuntimeRegion(owner.parentFrameKey, context.draft, context.index);
  return region === null ? null : selectorEnvironmentFor(region, context);
};

const finishRepeat = (
  context: RuntimeContext,
  owner: RepeatMachineFrame,
  node: ProgramRepeatNode,
  result: NodeTerminalResult,
  target: (typeof node.routes)[keyof typeof node.routes],
): boolean => {
  context.draft.deleteFrame(owner.key);
  return routeOwnedResult(context, owner.parentFrameKey, node.id, result, target);
};

const failRepeat = (
  context: RuntimeContext,
  owner: RepeatMachineFrame,
  node: ProgramRepeatNode,
  value: PipelineFailure,
): boolean => finishRepeat(context, owner, node, failedNode(value), node.routes.failed);

const outputResult = (
  node: ProgramRepeatNode,
  environment: SelectorEnvironment,
):
  | { readonly ok: true; readonly output: JsonValue }
  | { readonly ok: false; readonly failure: PipelineFailure } => {
  const output = resolveMapping(node.output, environment);
  if (!output.ok) {
    return Object.freeze({ ok: false, failure: failure('DATA_POINTER_MISSING', output.path) });
  }
  return valueMatchesSchema(node.outputSchema, output.value)
    ? Object.freeze({ ok: true, output: output.value })
    : Object.freeze({ ok: false, failure: failure('DATA_SCHEMA_MISMATCH') });
};

const startNextBody = (
  context: RuntimeContext,
  owner: RepeatMachineFrame,
  node: ProgramRepeatNode,
  environment: SelectorEnvironment,
): boolean => {
  const input = resolveMapping(node.nextInput, environment);
  if (!input.ok || !valueMatchesSchema(node.body.inputSchema, input.value)) {
    return failRepeat(
      context,
      owner,
      node,
      input.ok ? failure('DATA_SCHEMA_MISMATCH') : failure('DATA_POINTER_MISSING', input.path),
    );
  }
  const ordinal = owner.iteration + 1;
  const body = createRepeatBodyFrame(owner.key, ordinal, node.body, input.value);
  if (body === null || !context.draft.addFrame(body)) {
    return false;
  }
  context.draft.setFrame(
    Object.freeze({
      ...owner,
      iteration: ordinal,
      bodyRegionKey: body.key,
      bodyResult: null,
    }),
  );
  context.enqueue(body.key);
  return true;
};

const completeRepeatValue = (
  context: RuntimeContext,
  owner: RepeatMachineFrame,
  node: ProgramRepeatNode,
  frame: RepeatBodyMachineFrame,
  result: Extract<RegionTerminalResult, { readonly status: 'succeeded' }>,
  base: SelectorEnvironment,
): boolean => {
  const environment: SelectorEnvironment = {
    ...base,
    regionOutput: result.output,
    repeat: { iteration: frame.ordinal, previousOutput: result.output },
  };
  const condition = evaluateRepeatCondition(node.continueWhen, environment);
  if (!condition.ok) {
    return failRepeat(context, owner, node, failure('DATA_POINTER_MISSING', condition.path));
  }
  const updated = Object.freeze({ ...owner, previousOutput: result.output, bodyRegionKey: null });
  context.draft.setFrame(updated);
  if (condition.value && frame.ordinal + 1 < node.maximumIterations) {
    return startNextBody(context, updated, node, environment);
  }
  const output = outputResult(node, environment);
  if (!output.ok) {
    return failRepeat(context, updated, node, output.failure);
  }
  const target = condition.value ? node.routes.exhausted : node.routes.completed;
  return finishRepeat(context, updated, node, succeededNode(output.output), target);
};

export const completeRepeatBody = (
  context: RuntimeContext,
  frame: RepeatBodyMachineFrame,
  result: RegionTerminalResult,
  causality: CancellationCausality | null = null,
): boolean => {
  const current = context.draft.frames.get(frame.parentFrameKey);
  if (current?.kind !== 'repeat' || !pruneFrameTree(context.draft, frame.key)) {
    return false;
  }
  const node = ownerNode(context, current);
  const base = node === null ? null : parentEnvironment(context, current);
  if (node === null || base === null) {
    return false;
  }
  if (causality !== null && causality !== 'isolated') {
    context.draft.deleteFrame(current.key);
    return (
      storeOwnedResult(context, current.parentFrameKey, node.id, cleanupNodeResult(result)) &&
      context.completeRequested(current.parentFrameKey, result, causality)
    );
  }
  if (result.status === 'failed') {
    return failRepeat(context, current, node, result.failure);
  }
  if (result.status === 'cancelled') {
    return finishRepeat(context, current, node, cancelledNode(), node.routes.cancelled);
  }
  const classification = node.bodyExits.find(
    ({ outcome }) => outcome === result.outcome,
  )?.classification;
  if (classification === 'failed') {
    return failRepeat(context, current, node, readPipelineFailure(result.output));
  }
  if (classification === 'cancelled') {
    return finishRepeat(context, current, node, cancelledNode(), node.routes.cancelled);
  }
  if (classification !== 'value') {
    return false;
  }
  return completeRepeatValue(context, current, node, frame, result, base);
};
