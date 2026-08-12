import type { Digest, JsonPointer, PipelineFailure } from '../../../foundation/index.js';
import type { RegionMachineFrame } from '../../contracts/region-frames.js';
import type { PipelineState } from '../../contracts/state.js';
import { replaceFrame } from '../../state/canonical.js';
import { dataFailure } from '../commands.js';
import { recordNodeResult } from '../region-state.js';
import { continueAt, type BaseStepResult } from './types.js';

export const routeNodeFailure = (
  state: PipelineState,
  frame: RegionMachineFrame,
  moduleAncestry: readonly [string, ...string[]],
  nodeId: Digest,
  target: Digest,
  failure: PipelineFailure,
): BaseStepResult | null => {
  const advanced = recordNodeResult(
    frame,
    nodeId,
    Object.freeze({ status: 'failed', failure }),
    target,
  );
  return advanced === null
    ? null
    : continueAt(replaceFrame(state, advanced), frame.key, moduleAncestry);
};

export const pointerFailure = (path: JsonPointer) => dataFailure('DATA_POINTER_MISSING', path);
export const schemaFailure = (path: JsonPointer = '') => dataFailure('DATA_SCHEMA_MISMATCH', path);
