import type { PipelineValueFact } from './pipeline-value-fact.js';
import type { PipelineValueSource } from './pipeline-value-source.js';

export type PipelineValueRecord = {
  readonly fact: PipelineValueFact;
  readonly source: PipelineValueSource;
};
