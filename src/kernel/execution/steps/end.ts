import type { Digest, JsonPointer, JsonValue, PipelineFailure } from '../../../foundation/index.js';
import type { ProgramCallNode, ProgramEndNode } from '../../../program/index.js';
import type { KernelProgram } from '../../contracts/program.js';
import type { PipelineState } from '../../contracts/state.js';
import type { CallMachineFrame } from '../../contracts/structured-frames.js';
import {
  findExit,
  findFrame,
  findNode,
  resolveKnownRegion,
  type LookupCounters,
  type RegionContext,
} from '../../program/lookup.js';
import { replaceFrames } from '../../state/canonical.js';
import { completePipeline, failPipeline } from '../../state/terminal.js';
import { recordPendingNodeResult } from '../region-state.js';
import { resolveMapping, valueMatchesSchema } from '../selectors.js';
import { continueAt, type BaseStepResult } from './types.js';

const terminalFailure = (
  state: PipelineState,
  rootFrameKey: Digest,
  code: string,
  path: JsonPointer,
): BaseStepResult => {
  const failure: PipelineFailure = Object.freeze({ code, path });
  return Object.freeze({ kind: 'terminal', ...failPipeline(state, rootFrameKey, failure) });
};

const callTarget = (node: ProgramCallNode, outcome: string): Digest | null =>
  node.routes.outcomes.find((route) => route.outcome === outcome)?.target ?? null;

type CallCompletionContext = {
  readonly state: PipelineState;
  readonly parent: RegionContext;
  readonly frame: CallMachineFrame;
  readonly rootFrameKey: Digest;
  readonly parentModuleAncestry: readonly [string, ...string[]];
};

const finishCallInParent = (
  context: CallCompletionContext,
  outcome: string,
  output: JsonValue,
  counters?: LookupCounters,
): BaseStepResult | null => {
  const node = findNode(context.parent.region, context.frame.nodeId, counters);
  if (node?.kind !== 'call') {
    return null;
  }
  const target = callTarget(node, outcome);
  if (target === null || !valueMatchesSchema(node.outputSchema, output)) {
    return terminalFailure(context.state, context.rootFrameKey, 'INVARIANT_PROGRAM_STATE', '');
  }
  const parent = recordPendingNodeResult(
    context.parent.frame,
    node.id,
    Object.freeze({ status: 'succeeded', output }),
    target,
  );
  if (parent === null) {
    return null;
  }
  const nextState = replaceFrames(
    context.state,
    new Set([context.frame.key, context.frame.childRegionKey ?? '', context.parent.frame.key]),
    [parent],
  );
  return continueAt(nextState, parent.key, context.parentModuleAncestry);
};

export const finishRegion = (
  bundle: KernelProgram,
  state: PipelineState,
  context: RegionContext,
  node: ProgramEndNode,
  rootFrameKey: Digest,
  counters?: LookupCounters,
): BaseStepResult | null => {
  const output = resolveMapping(node.output, {
    moduleInput: context.moduleInput,
    scopeInput: context.frame.scopeInput,
    nodeResults: context.frame.nodeResults,
  });
  if (!output.ok) {
    return terminalFailure(state, rootFrameKey, 'DATA_POINTER_MISSING', output.path);
  }
  const exit = findExit(context.region, node.outcome, counters);
  if (exit === null || !valueMatchesSchema(exit.outputSchema, output.value)) {
    return terminalFailure(state, rootFrameKey, 'DATA_SCHEMA_MISMATCH', '');
  }
  if (context.frame.kind === 'rootRegion') {
    const terminal = completePipeline(state, rootFrameKey, node.outcome, output.value);
    return Object.freeze({ kind: 'terminal', ...terminal });
  }
  const callFrame = findFrame(state, context.frame.parentFrameKey, counters);
  if (callFrame?.kind !== 'call') {
    return null;
  }
  const parentModuleAncestry = context.moduleAncestry.slice(0, -1);
  const [parentModuleKey, ...remainingModuleKeys] = parentModuleAncestry;
  if (parentModuleKey === undefined) {
    return null;
  }
  const nonEmptyParentAncestry: readonly [string, ...string[]] = [
    parentModuleKey,
    ...remainingModuleKeys,
  ];
  const parentContext = resolveKnownRegion(
    bundle,
    state,
    callFrame.parentFrameKey,
    nonEmptyParentAncestry,
    counters,
  );
  return parentContext === null
    ? null
    : finishCallInParent(
        {
          state,
          parent: parentContext,
          frame: callFrame,
          rootFrameKey,
          parentModuleAncestry: nonEmptyParentAncestry,
        },
        node.outcome,
        output.value,
        counters,
      );
};
