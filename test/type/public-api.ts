import {
  compilePipeline,
  decidePipeline,
  decodeCompiledPipeline,
  definePipeline,
  reducePipeline,
  type ActivateDecision,
  type ActivationCause,
  type AllJoinPolicy,
  type AnyJoinPolicy,
  type BranchCase,
  type BranchDefault,
  type BranchName,
  type BranchNode,
  type BranchPredicate,
  type CandidateKey,
  type CandidateVerdict,
  type CompiledEdge,
  type CompiledEdgeIndexEntry,
  type CompiledEdgeRole,
  type CompiledForkBranch,
  type CompiledForkRegion,
  type CompiledNode,
  type CompiledNodeIndexEntry,
  type CompiledPipeline,
  type CompiledPipelineDecoding,
  type ConsensusNode,
  type ConsensusOutcome,
  type ConsensusPolicy,
  type ConsensusRoutes,
  type DecisionFault,
  type DecisionFaultCode,
  type DecodeFault,
  type DecodeFaultCode,
  type DefinitionFault,
  type DefinitionFaultCode,
  type FactDefinition,
  type FactKey,
  type FactType,
  type ForkBranch,
  type ForkNode,
  type GateResolution,
  type HumanGateNode,
  type HumanGateRoute,
  type JoinNode,
  type JoinOutcome,
  type JoinPolicy,
  type JoinRoutes,
  type JsonScalar,
  type NodeFact,
  type NodeKey,
  type NoopDecision,
  type PipelineCompilation,
  type PipelineDecision,
  type PipelineDefinition,
  type PipelineFacts,
  type PipelineNode,
  type PipelineCandidateVerdictRecord,
  type PipelineCommand,
  type PipelineCommandApplication,
  type PipelineEffect,
  type PipelineEffectBatch,
  type PipelineForkRelation,
  type PipelineGateResolutionRecord,
  type PipelineNodeOccurrence,
  type PipelineOccurrenceKey,
  type PipelineReduction,
  type PipelineReductionFault,
  type PipelineReductionFaultCode,
  type PipelineReductionStatus,
  type PipelineRetirement,
  type PipelineSnapshot,
  type PipelineSnapshotNode,
  type PipelineTerminal,
  type PipelineValueRecord,
  type PipelineValueSource,
  type PipelineWait,
  type PipelineValueFact,
  type QuorumConsensusPolicy,
  type RejectDecision,
  type ResolutionName,
  type SelectDecision,
  type TaskNode,
  type TaskOutcome,
  type TaskRoutes,
  type TerminalDecision,
  type TerminalNode,
  type ThresholdConsensusPolicy,
  type ThresholdJoinPolicy,
  type UnanimousConsensusPolicy,
  type WaitDecision,
  type WaitReason,
} from '../../src/index.js';

export type PublicTypeManifest = readonly [
  JsonScalar,
  NodeKey,
  FactKey,
  CandidateKey,
  BranchName,
  ResolutionName,
  TaskOutcome,
  FactType,
  FactDefinition,
  TaskRoutes,
  BranchPredicate,
  BranchCase,
  BranchDefault,
  ForkBranch,
  AllJoinPolicy,
  AnyJoinPolicy,
  ThresholdJoinPolicy,
  JoinPolicy,
  JoinOutcome,
  JoinRoutes,
  UnanimousConsensusPolicy,
  QuorumConsensusPolicy,
  ThresholdConsensusPolicy,
  ConsensusPolicy,
  ConsensusOutcome,
  ConsensusRoutes,
  HumanGateRoute,
  TaskNode,
  BranchNode,
  ForkNode,
  JoinNode,
  ConsensusNode,
  HumanGateNode,
  TerminalNode,
  PipelineNode,
  PipelineDefinition,
  CompiledNode,
  CompiledEdgeRole,
  CompiledEdge,
  CompiledForkBranch,
  CompiledForkRegion,
  CompiledNodeIndexEntry,
  CompiledEdgeIndexEntry,
  CompiledPipeline,
  CompiledPipelineDecoding,
  DecodeFaultCode,
  DecodeFault,
  DefinitionFaultCode,
  DefinitionFault,
  PipelineCompilation,
  NodeFact,
  PipelineValueFact,
  CandidateVerdict,
  GateResolution,
  PipelineFacts,
  ActivationCause,
  WaitReason,
  DecisionFaultCode,
  DecisionFault,
  ActivateDecision,
  SelectDecision,
  WaitDecision,
  TerminalDecision,
  NoopDecision,
  RejectDecision,
  PipelineDecision,
  PipelineCandidateVerdictRecord,
  PipelineCommand,
  PipelineCommandApplication,
  PipelineEffect,
  PipelineEffectBatch,
  PipelineForkRelation,
  PipelineGateResolutionRecord,
  PipelineNodeOccurrence,
  PipelineOccurrenceKey,
  PipelineReduction,
  PipelineReductionFault,
  PipelineReductionFaultCode,
  PipelineReductionStatus,
  PipelineRetirement,
  PipelineSnapshot,
  PipelineSnapshotNode,
  PipelineTerminal,
  PipelineValueRecord,
  PipelineValueSource,
  PipelineWait,
];

const definition = definePipeline({
  schemaVersion: 1,
  entry: 'approval',
  facts: [],
  nodes: [
    {
      kind: 'humanGate',
      key: 'approval',
      subject: 'Approve the change',
      resolutions: [
        { resolution: 'approved', to: 'published' },
        { resolution: 'rejected', to: 'cancelled' },
      ],
    },
    { kind: 'terminal', key: 'published', outcome: 'published' },
    { kind: 'terminal', key: 'cancelled', outcome: 'cancelled' },
  ],
});

const literalEntry: 'approval' = definition.entry;
const literalKind: 'humanGate' = definition.nodes[0].kind;
const publicTypeCount: PublicTypeManifest['length'] = 86;
const acceptedPublicTypeCount: 86 = publicTypeCount;
const assertNever = (value: never): never => {
  throw new Error(`Unexpected public union member: ${String(value)}`);
};
const compilation: PipelineCompilation = compilePipeline(definition);
const decoding: CompiledPipelineDecoding = decodeCompiledPipeline(
  compilation.ok ? compilation.pipeline : undefined,
);

if (compilation.ok) {
  const decoded: CompiledPipelineDecoding = decodeCompiledPipeline(
    JSON.parse(JSON.stringify(compilation.pipeline)),
  );
  if (!decoded.ok) {
    const decodeFault = decoded.faults[0];
    void decodeFault;
  } else {
    const facts: PipelineFacts = {
      values: [],
      nodes: [{ key: 'approval', state: 'enabled' }],
      candidateVerdicts: [],
      gateResolutions: [],
    };
    const decision: PipelineDecision = decidePipeline(compilation.pipeline, facts);
    switch (decision.kind) {
      case 'activate':
        void decision.nodeKeys;
        break;
      case 'select':
        void decision.activate;
        break;
      case 'wait':
        void decision.reason;
        break;
      case 'terminal':
        void decision.outcome;
        break;
      case 'noop':
        void decision.reason;
        break;
      case 'reject':
        void decision.faults;
        break;
      default:
        assertNever(decision);
    }
    const snapshot: PipelineSnapshot = {
      schemaVersion: 1,
      occurrenceKey: 'example',
      phase: 'uninitialized',
      values: [],
      nodes: [],
      candidateVerdicts: [],
      gateResolutions: [],
      terminal: null,
    };
    const reduction: PipelineReduction = reducePipeline(compilation.pipeline, snapshot, {
      schemaVersion: 1,
      kind: 'init',
      values: [],
    });
    if (!reduction.ok) {
      const reductionFault = reduction.faults[0];
      void reductionFault;
    } else {
      void reduction.application;
      void reduction.snapshot;
      void reduction.batch;
      switch (reduction.status) {
        case 'waiting':
          void reduction.wait;
          break;
        case 'terminal':
          void reduction.terminal;
          break;
        default:
          assertNever(reduction);
      }
    }
  }
}

void literalEntry;
void literalKind;
void publicTypeCount;
void acceptedPublicTypeCount;
void decoding;
