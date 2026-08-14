import { computeRedactedDigest, type Digest } from '../foundation/index.js';
import type { PipelineSourcePackage } from './contracts/index.js';
import { validatePipelineSource } from './validate.js';

export const definePipelineSource = <const Value extends PipelineSourcePackage>(
  value: Value,
): Value => value;

export const computeSourceDigest = (source: PipelineSourcePackage): Digest =>
  computeRedactedDigest(() => {
    const result = validatePipelineSource(source);
    return result.ok ? result.value.sourceDigest : null;
  });
