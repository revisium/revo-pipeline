import type { PipelineNodeOccurrence } from './pipeline-node-occurrence.js';
import type { PipelineOccurrenceKey } from './pipeline-occurrence-key.js';

export type PipelineValueSource =
  | { readonly kind: 'init'; readonly occurrenceKey: PipelineOccurrenceKey }
  | { readonly kind: 'taskOutcome'; readonly occurrence: PipelineNodeOccurrence }
  | { readonly kind: 'humanGateResolution'; readonly occurrence: PipelineNodeOccurrence };
