import { expectTypeOf, test } from 'vitest';

import type {
  DecisionFault,
  DecisionFaultCode,
  DefinitionFault,
  DefinitionFaultCode,
  PipelineCompilation,
  PipelineDecision,
  RejectDecision,
} from '../../../src/errors/index.js';
import type {
  ActivateDecision,
  ActivationCause,
  AllJoinPolicy,
  AnyJoinPolicy,
  BranchCase,
  BranchDefault,
  BranchName,
  BranchNode,
  BranchPredicate,
  CandidateKey,
  CandidateVerdict,
  CompiledEdge,
  CompiledEdgeIndexEntry,
  CompiledEdgeRole,
  CompiledForkBranch,
  CompiledForkRegion,
  CompiledNode,
  CompiledNodeIndexEntry,
  CompiledPipeline,
  ConsensusNode,
  ConsensusOutcome,
  ConsensusPolicy,
  ConsensusRoutes,
  FactDefinition,
  FactKey,
  FactType,
  ForkBranch,
  ForkNode,
  GateResolution,
  HumanGateNode,
  HumanGateRoute,
  JoinNode,
  JoinOutcome,
  JoinPolicy,
  JoinRoutes,
  JsonScalar,
  NodeFact,
  NodeKey,
  NoopDecision,
  PipelineDefinition,
  PipelineFacts,
  PipelineNode,
  PipelineValueFact,
  QuorumConsensusPolicy,
  ResolutionName,
  SelectDecision,
  TaskNode,
  TaskOutcome,
  TaskRoutes,
  TerminalDecision,
  TerminalNode,
  ThresholdConsensusPolicy,
  ThresholdJoinPolicy,
  UnanimousConsensusPolicy,
  WaitDecision,
  WaitReason,
} from '../../../src/spec/index.js';

type AcceptedSpecManifest = readonly [
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
  NodeFact,
  PipelineValueFact,
  CandidateVerdict,
  GateResolution,
  PipelineFacts,
  ActivationCause,
  WaitReason,
  ActivateDecision,
  SelectDecision,
  WaitDecision,
  TerminalDecision,
  NoopDecision,
];

type AcceptedErrorManifest = readonly [
  DefinitionFaultCode,
  DefinitionFault,
  PipelineCompilation,
  DecisionFaultCode,
  DecisionFault,
  RejectDecision,
  PipelineDecision,
];

test('exposes every accepted contract through curated type-only barrels', () => {
  expectTypeOf<AcceptedSpecManifest>().toMatchTypeOf<readonly unknown[]>();
  expectTypeOf<AcceptedErrorManifest>().toMatchTypeOf<readonly unknown[]>();
});

test('preserves exact accepted scalar, outcome, node and decision unions', () => {
  expectTypeOf<JsonScalar>().toEqualTypeOf<null | boolean | number | string>();
  expectTypeOf<TaskOutcome>().toEqualTypeOf<'completed' | 'failed' | 'cancelled' | 'skipped'>();
  expectTypeOf<JoinOutcome>().toEqualTypeOf<'completed' | 'rejected' | 'insufficient'>();
  expectTypeOf<ConsensusOutcome>().toEqualTypeOf<
    'approved' | 'rejected' | 'insufficient' | 'tied'
  >();
  expectTypeOf<WaitReason>().toEqualTypeOf<
    | 'task-incomplete'
    | 'branch-fact-missing'
    | 'join-incomplete'
    | 'consensus-incomplete'
    | 'gate-unresolved'
  >();
  expectTypeOf<PipelineNode['kind']>().toEqualTypeOf<
    'task' | 'script' | 'branch' | 'fork' | 'join' | 'consensus' | 'humanGate' | 'terminal'
  >();
  expectTypeOf<PipelineDecision['kind']>().toEqualTypeOf<
    'activate' | 'select' | 'wait' | 'terminal' | 'noop' | 'reject'
  >();
});

test('preserves exact accepted fault-code unions', () => {
  expectTypeOf<DefinitionFaultCode>().toEqualTypeOf<
    | 'DEF_TYPE'
    | 'DEF_UNKNOWN_FIELD'
    | 'DEF_LIMIT'
    | 'DEF_SCHEMA'
    | 'DEF_KEY'
    | 'DEF_DUPLICATE'
    | 'DEF_ENTRY'
    | 'DEF_TARGET'
    | 'DEF_UNREACHABLE'
    | 'DEF_DEAD_END'
    | 'DEF_EDGE'
    | 'DEF_CYCLE'
    | 'DEF_BRANCH_AMBIGUOUS'
    | 'DEF_BRANCH_NON_EXHAUSTIVE'
    | 'DEF_BRANCH_UNREACHABLE_DEFAULT'
    | 'DEF_FORK_ARITY'
    | 'DEF_FORK_JOIN'
    | 'DEF_FORK_REGION'
    | 'DEF_FORK_NESTED'
    | 'DEF_JOIN_THRESHOLD'
    | 'DEF_CONSENSUS_CANDIDATE'
    | 'DEF_CONSENSUS_BOUND'
    | 'DEF_GATE_RESOLUTION'
  >();
  expectTypeOf<DecisionFaultCode>().toEqualTypeOf<
    | 'PIPELINE_INVALID'
    | 'FACT_TYPE'
    | 'FACT_LIMIT'
    | 'FACT_DUPLICATE'
    | 'FACT_FOREIGN'
    | 'FACT_OUTCOME'
    | 'FACT_CANDIDATE'
    | 'FACT_RESOLUTION'
    | 'FACT_PREMATURE'
    | 'FACT_CAUSAL'
  >();
});

const assertReadonlyContracts = (
  definition: PipelineDefinition,
  compiled: CompiledPipeline,
  facts: PipelineFacts,
  task: TaskNode,
  fault: DefinitionFault,
): void => {
  // @ts-expect-error -- accepted definitions are readonly.
  definition.entry = 'changed';
  // @ts-expect-error -- accepted definition collections are readonly.
  definition.nodes[0] = task;
  // @ts-expect-error -- compiled indexes are readonly.
  compiled.nodeIndex[0] = { key: 'changed', node: 0 };
  // @ts-expect-error -- fact collections are readonly.
  facts.nodes[0] = { key: 'changed', state: 'enabled' };
  // @ts-expect-error -- task routes are readonly.
  task.outcomes.completed = 'changed';
  // @ts-expect-error -- fault records are readonly.
  fault.message = 'changed';
};

void assertReadonlyContracts;
