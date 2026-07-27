import type { PipelineEffect } from './pipeline-effect.js';

export type PipelineEffectBatch = {
  readonly kind: 'atomic';
  readonly items: readonly PipelineEffect[];
};
