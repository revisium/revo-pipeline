import {
  compilePipeline,
  decidePipeline,
  definePipeline,
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
  type ConsensusNode,
  type ConsensusOutcome,
  type ConsensusPolicy,
  type ConsensusRoutes,
  type DecisionFault,
  type DecisionFaultCode,
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
const publicTypeCount: PublicTypeManifest['length'] = 63;
const acceptedPublicTypeCount: 63 = publicTypeCount;
const assertNever = (value: never): never => {
  throw new Error(`Unexpected public union member: ${String(value)}`);
};
const compilation: PipelineCompilation = compilePipeline(definition);

if (compilation.ok) {
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
}

void literalEntry;
void literalKind;
void publicTypeCount;
void acceptedPublicTypeCount;
