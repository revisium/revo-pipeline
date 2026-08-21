import type { JsonPointer, JsonValue } from '../foundation/index.js';

export type PipelineExecutionPolicies = {
  readonly defaultTaskTimeoutMs: number;
  readonly maximumActiveNodeExecutions: number;
  readonly maximumNodeNestingDepth: number;
  readonly maximumSubpipelineDepth: number;
  readonly maximumTotalNodeExecutions: number;
};

export type PipelineExecutionBindings = readonly [];

export type PipelineExecutionValueSource =
  | { readonly kind: 'literal'; readonly value: JsonValue }
  | { readonly kind: 'pipelineInput'; readonly pointer: JsonPointer };

export type PipelineExecutionEndNode = {
  readonly kind: 'end';
  readonly status: 'succeeded';
  readonly outcome: string;
  readonly output: Readonly<Record<string, PipelineExecutionValueSource>>;
};

export type PipelineExecutionChoiceNode = {
  readonly kind: 'choice';
  readonly key: string;
  readonly selector: PipelineExecutionValueSource;
  readonly cases: Readonly<Record<string, PipelineExecutionNode>>;
  readonly default: PipelineExecutionNode;
};

export type PipelineExecutionNode = PipelineExecutionChoiceNode | PipelineExecutionEndNode;

export type PipelineExecutionPlan = {
  readonly schemaVersion: 'pipeline-execution-plan/v1';
  readonly rootPipelineId: string;
  readonly pipelines: Readonly<Record<string, { readonly root: PipelineExecutionNode }>>;
  readonly bindings: PipelineExecutionBindings;
  readonly policies: PipelineExecutionPolicies;
};

export type PipelineExecutionPlanOptions = {
  readonly bindings: PipelineExecutionBindings;
  readonly policies: PipelineExecutionPolicies;
};
