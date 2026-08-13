import type { ProgramRepeatNode } from '../../../program/index.js';
import { consumeRegionNode } from '../region-state.js';
import { resolveMapping, valueMatchesSchema, type SelectorEnvironment } from '../selectors.js';
import type { RuntimeContext } from './context.js';
import { createRepeatOwner } from './owner-frames.js';
import { routeImmediateResult } from './parent-result.js';
import { createRepeatBodyFrame } from './region-frames.js';
import { failedNode, failure } from './results.js';

export const startRepeat = (
  context: RuntimeContext,
  parentKey: Parameters<typeof createRepeatOwner>[0],
  node: ProgramRepeatNode,
  environment: SelectorEnvironment,
): boolean => {
  const input = resolveMapping(node.initialInput, environment);
  if (!input.ok || !valueMatchesSchema(node.body.inputSchema, input.value)) {
    const dataFailure = input.ok
      ? failure('DATA_SCHEMA_MISMATCH')
      : failure('DATA_POINTER_MISSING', input.path);
    return routeImmediateResult(
      context,
      parentKey,
      node.id,
      failedNode(dataFailure),
      node.routes.failed,
    );
  }
  const parent = context.draft.frames.get(parentKey);
  if (parent === undefined || !('ready' in parent)) {
    return false;
  }
  const consumed = consumeRegionNode(parent, node.id);
  const owner = createRepeatOwner(parentKey, parent.scopeInput, node);
  const body = owner === null ? null : createRepeatBodyFrame(owner.key, 0, node.body, input.value);
  if (consumed === null || owner === null || body === null) {
    return false;
  }
  context.draft.setFrame(consumed);
  if (
    !context.draft.addFrame(Object.freeze({ ...owner, bodyRegionKey: body.key })) ||
    !context.draft.addFrame(body)
  ) {
    return false;
  }
  context.enqueue(body.key);
  return true;
};
