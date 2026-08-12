import type { ProgramCallNode } from '../../../program/index.js';
import type { KernelProgram } from '../../contracts/program.js';
import type { PipelineState } from '../../contracts/state.js';
import { findModule, type LookupCounters, type RegionContext } from '../../program/lookup.js';
import { replaceFrames } from '../../state/canonical.js';
import { createCallFrames } from '../../state/frames.js';
import { consumeRegionNode } from '../region-state.js';
import { resolveMapping, valueMatchesSchema } from '../selectors.js';
import { pointerFailure, routeNodeFailure, schemaFailure } from './failure.js';
import { continueAt, type BaseStepResult } from './types.js';

export const startCall = (
  bundle: KernelProgram,
  state: PipelineState,
  context: RegionContext,
  node: ProgramCallNode,
  counters?: LookupCounters,
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
  const calledModule = findModule(bundle, node.module, counters);
  if (
    calledModule === null ||
    !valueMatchesSchema(calledModule.inputSchema, input.value) ||
    !valueMatchesSchema(calledModule.region.inputSchema, input.value)
  ) {
    return routeNodeFailure(
      state,
      context.frame,
      context.moduleAncestry,
      node.id,
      node.routes.failed,
      schemaFailure(),
    );
  }
  const parent = consumeRegionNode(context.frame, node.id);
  const callFrames = createCallFrames(context.frame.key, node, calledModule.region, input.value);
  if (parent === null || callFrames === null) {
    return null;
  }
  const nextState = replaceFrames(state, new Set([context.frame.key]), [
    parent,
    callFrames.owner,
    callFrames.region,
  ]);
  return continueAt(nextState, callFrames.region.key, [
    ...context.moduleAncestry,
    calledModule.key,
  ]);
};
