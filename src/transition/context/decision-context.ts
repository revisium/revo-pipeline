import type { PipelineNode } from '../../spec/index.js';
import type { HostileCompiledValidation } from '../compiled/hostile-compiled-validation.js';

type SuccessfulCompiledValidation = Extract<HostileCompiledValidation, { readonly ok: true }>;

export interface DecisionContext {
  readonly compiled: SuccessfulCompiledValidation;
  readonly candidatesByNode: ReadonlyMap<string, ReadonlySet<string>>;
  readonly incomingByKey: ReadonlyMap<string, readonly number[]>;
  readonly nodeByKey: ReadonlyMap<string, PipelineNode>;
  readonly outgoingByKey: ReadonlyMap<string, readonly number[]>;
  readonly regionByFork: ReadonlyMap<
    string,
    SuccessfulCompiledValidation['snapshot']['forkRegions'][number]
  >;
  readonly regionByJoin: ReadonlyMap<
    string,
    SuccessfulCompiledValidation['snapshot']['forkRegions'][number]
  >;
  readonly regionOwnerByNode: ReadonlyMap<string, string>;
  readonly resolutionsByNode: ReadonlyMap<string, ReadonlySet<string>>;
  readonly topologicalPosition: ReadonlyMap<string, number>;
}
