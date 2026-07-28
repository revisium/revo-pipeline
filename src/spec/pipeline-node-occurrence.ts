import type { NodeKey } from './node-key.js';
import type { PipelineOccurrenceKey } from './pipeline-occurrence-key.js';

export type PipelineNodeOccurrence = {
  readonly occurrenceKey: PipelineOccurrenceKey;
  readonly nodeKey: NodeKey;
};
