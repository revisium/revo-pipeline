import type { ProgramActivityNode } from '../../../program/index.js';
import type { KernelProgram } from '../../contracts/program.js';
import type { PipelineState } from '../../contracts/state.js';
import type { RegionContext } from '../../program/lookup.js';
import { ownPipelineState, replaceFrame } from '../../state/canonical.js';
import { dispatchActivityCommand, nodeReference } from '../commands.js';
import { consumeRegionNode } from '../region-state.js';
import { resolveMapping, valueMatchesSchema } from '../selectors.js';
import { pointerFailure, routeNodeFailure, schemaFailure } from './failure.js';
import type { BaseStepResult } from './types.js';

export const startActivity = (
  bundle: KernelProgram,
  state: PipelineState,
  context: RegionContext,
  node: ProgramActivityNode,
): BaseStepResult | null => {
  const input = resolveMapping(node.input, {
    moduleInput: context.moduleInput,
    scopeInput: context.frame.scopeInput,
    nodeResults: context.frame.nodeResults,
  });
  if (!input.ok) {
    return routeNodeFailure(
      state,
      context.frame,
      context.moduleAncestry,
      node.id,
      node.routes.failed,
      pointerFailure(input.path),
    );
  }
  if (!valueMatchesSchema(node.inputSchema, input.value)) {
    return routeNodeFailure(
      state,
      context.frame,
      context.moduleAncestry,
      node.id,
      node.routes.failed,
      schemaFailure(),
    );
  }
  const frame = consumeRegionNode(context.frame, node.id);
  if (frame === null) {
    return null;
  }
  const ref = nodeReference(bundle.programDigest, context.frame.key, node.id);
  const command = dispatchActivityCommand(ref, node.requirementKey, input.value, node.outputSchema);
  if (command === null) {
    return null;
  }
  const operation = Object.freeze({
    kind: 'activity' as const,
    commandKey: command.key,
    ref,
    requirementKey: node.requirementKey,
  });
  const nextState = ownPipelineState({
    ...replaceFrame(state, frame),
    pending: [...state.pending, operation],
  });
  return Object.freeze({
    kind: 'boundary',
    state: nextState,
    commands: Object.freeze([command]),
  });
};
