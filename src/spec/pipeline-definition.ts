import type { FactDefinition } from './fact-definition.js';
import type { NodeKey } from './node-key.js';
import type { PipelineNode } from './pipeline-node.js';

export type PipelineDefinition = {
  readonly schemaVersion: 1;
  readonly entry: NodeKey;
  readonly facts: readonly FactDefinition[];
  readonly nodes: readonly PipelineNode[];
};
