import type {
  CandidateVerdict,
  GateResolution,
  JsonScalar,
  NodeFact,
  PipelineValueFact,
} from '../../spec/index.js';

type IndexedFact<T> = { readonly fact: T; readonly sourceIndex: number };
type ConsensusFacts = {
  readonly approvals: number;
  readonly rejections: number;
  readonly total: number;
};

export interface ValidatedFacts {
  readonly candidateVerdicts: readonly IndexedFact<CandidateVerdict>[];
  readonly consensusByNode: ReadonlyMap<string, ConsensusFacts>;
  readonly gateResolutions: readonly IndexedFact<GateResolution>[];
  readonly gateResolutionByNode: ReadonlyMap<string, GateResolution>;
  readonly nodes: readonly IndexedFact<NodeFact>[];
  readonly nodeByKey: ReadonlyMap<string, NodeFact>;
  readonly values: readonly PipelineValueFact[];
  readonly valueByKey: ReadonlyMap<string, JsonScalar>;
}
