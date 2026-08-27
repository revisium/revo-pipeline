import type { Digest } from '../../../foundation/index.js';
import type {
  ProgramActivityNode,
  ProgramCallNode,
  ProgramChoiceNode,
  ProgramHumanGateNode,
  ProgramWaitNode,
} from '../../../program/index.js';
import { createCallFrames } from '../../state/frames.js';
import {
  dispatchActivityCommand,
  nodeReference,
  openHumanGateCommand,
  scheduleWaitCommand,
} from '../commands.js';
import { consumeRegionNode } from '../region-state.js';
import {
  choiceMatches,
  resolveMapping,
  resolveSelector,
  valueMatchesSchema,
  type SelectorEnvironment,
} from '../selectors.js';
import type { RuntimeContext } from './context.js';
import { routeImmediateResult } from './parent-result.js';
import { findRuntimeModule } from './program-index.js';
import { completeFailedRegion } from './region-completion.js';
import { failedNode, failure } from './results.js';

const addExternalOperation = (
  context: RuntimeContext,
  parentKey: Digest,
  nodeId: Digest,
  operation: Parameters<RuntimeContext['draft']['addPending']>[0],
  command: Parameters<RuntimeContext['draft']['addCommand']>[0],
): boolean => {
  const parent = context.draft.frames.get(parentKey);
  if (parent === undefined || !('ready' in parent)) {
    return false;
  }
  const consumed = consumeRegionNode(parent, nodeId);
  if (consumed === null) {
    return false;
  }
  context.draft.setFrame(consumed);
  return context.draft.addPending(operation) && context.draft.addCommand(command);
};

export const startActivityNode = (
  context: RuntimeContext,
  parentKey: Digest,
  node: ProgramActivityNode,
  environment: SelectorEnvironment,
): boolean => {
  const input = resolveMapping(node.input, environment);
  if (!input.ok || !valueMatchesSchema(node.inputSchema, input.value)) {
    return routeImmediateResult(
      context,
      parentKey,
      node.id,
      failedNode(
        input.ok ? failure('DATA_SCHEMA_MISMATCH') : failure('DATA_POINTER_MISSING', input.path),
      ),
      node.routes.failed,
    );
  }
  const ref = nodeReference(context.draft.programDigest, parentKey, node.id);
  const command = dispatchActivityCommand(ref, node.requirementKey, input.value, node.outputSchema);
  return (
    command !== null &&
    addExternalOperation(
      context,
      parentKey,
      node.id,
      Object.freeze({
        kind: 'activity',
        commandKey: command.key,
        ref,
        requirementKey: node.requirementKey,
      }),
      command,
    )
  );
};

export const startWaitNode = (
  context: RuntimeContext,
  parentKey: Digest,
  node: ProgramWaitNode,
): boolean => {
  const ref = nodeReference(context.draft.programDigest, parentKey, node.id);
  const command = scheduleWaitCommand(ref, node.wait);
  return (
    command !== null &&
    addExternalOperation(
      context,
      parentKey,
      node.id,
      Object.freeze({ kind: 'wait', commandKey: command.key, ref, waitKind: node.wait.kind }),
      command,
    )
  );
};

export const startHumanGateNode = (
  context: RuntimeContext,
  parentKey: Digest,
  node: ProgramHumanGateNode,
): boolean => {
  const ref = nodeReference(context.draft.programDigest, parentKey, node.id);
  const command = openHumanGateCommand(
    ref,
    node.subject,
    node.answers,
    node.authorizationRequirements,
    node.payloadSchema,
    node.deadline === null ? null : Object.freeze({ afterMs: node.deadline.afterMs }),
  );
  return (
    command !== null &&
    addExternalOperation(
      context,
      parentKey,
      node.id,
      Object.freeze({ kind: 'humanGate', commandKey: command.key, ref }),
      command,
    )
  );
};

export const selectChoiceNode = (
  context: RuntimeContext,
  parentKey: Digest,
  node: ProgramChoiceNode,
  environment: SelectorEnvironment,
): boolean => {
  const selected = resolveSelector(node.selector, environment);
  if (!selected.ok) {
    const parent = context.draft.frames.get(parentKey);
    return (
      parent !== undefined &&
      'ready' in parent &&
      completeFailedRegion(context, parent, failure('DATA_POINTER_MISSING', selected.path))
    );
  }
  const target =
    node.cases.find(({ when }) => choiceMatches(selected.value, when))?.target ?? node.otherwise;
  const parent = context.draft.frames.get(parentKey);
  if (target === null || parent === undefined || !('ready' in parent)) {
    return false;
  }
  const consumed = consumeRegionNode(parent, node.id, target);
  if (consumed === null) {
    return false;
  }
  context.draft.setFrame(consumed);
  context.enqueue(parentKey);
  return true;
};

export const startCallNode = (
  context: RuntimeContext,
  parentKey: Digest,
  node: ProgramCallNode,
  environment: SelectorEnvironment,
): boolean => {
  const input = resolveMapping(node.input, environment);
  const module = findRuntimeModule(context.index, node.module);
  if (
    !input.ok ||
    module === null ||
    !valueMatchesSchema(module.inputSchema, input.value) ||
    !valueMatchesSchema(module.region.inputSchema, input.value)
  ) {
    return routeImmediateResult(
      context,
      parentKey,
      node.id,
      failedNode(
        input.ok ? failure('DATA_SCHEMA_MISMATCH') : failure('DATA_POINTER_MISSING', input.path),
      ),
      node.routes.failed,
    );
  }
  const parent = context.draft.frames.get(parentKey);
  if (parent === undefined || !('ready' in parent)) {
    return false;
  }
  const consumed = consumeRegionNode(parent, node.id);
  const frames = createCallFrames(parentKey, node, module.region, input.value);
  if (consumed === null || frames === null) {
    return false;
  }
  context.draft.setFrame(consumed);
  if (!context.draft.addFrame(frames.owner) || !context.draft.addFrame(frames.region)) {
    return false;
  }
  context.enqueue(frames.region.key);
  return true;
};
