import type { DefinitionFaultCode } from '../../errors/index.js';
import type { FactDefinition, PipelineNode } from '../../spec/index.js';

export interface DefinitionValidationResult {
  readonly canCompile: boolean;
  readonly entry: string;
  readonly facts: readonly FactDefinition[];
  readonly nodes: readonly PipelineNode[];
  readonly sourceIndexes: ReadonlyMap<string, number>;
  readonly sourceNodes: ReadonlyMap<string, PipelineNode>;
  readonly faults: {
    code: DefinitionFaultCode;
    path: string;
    message: string;
  }[];
}
