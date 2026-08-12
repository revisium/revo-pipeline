import type { Digest, JsonPointer, PipelineFailure } from '../../../foundation/index.js';
import type { ProgramChoiceNode } from '../../../program/index.js';
import type { PipelineState } from '../../contracts/state.js';
import type { RegionContext } from '../../program/lookup.js';
import { replaceFrame } from '../../state/canonical.js';
import { failPipeline } from '../../state/terminal.js';
import { consumeRegionNode } from '../region-state.js';
import { choiceMatches, resolveSelector } from '../selectors.js';
import { continueAt, type BaseStepResult } from './types.js';

const terminalFailure = (
  state: PipelineState,
  rootFrameKey: Digest,
  code: string,
  path: JsonPointer,
): BaseStepResult => {
  const failure: PipelineFailure = Object.freeze({ code, path });
  const terminal = failPipeline(state, rootFrameKey, failure);
  return Object.freeze({ kind: 'terminal', ...terminal });
};

export const selectChoice = (
  state: PipelineState,
  context: RegionContext,
  node: ProgramChoiceNode,
  rootFrameKey: Digest,
): BaseStepResult | null => {
  const selected = resolveSelector(node.selector, {
    moduleInput: context.moduleInput,
    scopeInput: context.frame.scopeInput,
    nodeResults: context.frame.nodeResults,
  });
  if (!selected.ok) {
    return terminalFailure(state, rootFrameKey, 'DATA_POINTER_MISSING', selected.path);
  }
  const matched = node.cases.find(({ when }) => choiceMatches(selected.value, when));
  const target = matched?.target ?? node.otherwise;
  if (target === null) {
    return terminalFailure(state, rootFrameKey, 'INVARIANT_PROGRAM_STATE', '');
  }
  const frame = consumeRegionNode(context.frame, node.id, target);
  return frame === null
    ? null
    : continueAt(replaceFrame(state, frame), context.frame.key, context.moduleAncestry);
};
