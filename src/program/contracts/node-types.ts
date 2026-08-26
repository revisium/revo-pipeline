import type {
  ChoiceDomain,
  ConsensusPolicy,
  JsonPointer,
  JsonValue,
  ParallelBranchClassification,
  ParallelPolicy,
  PipelineFailure,
  RegionExitClassification,
  ValueSchema,
} from '../../foundation/index.js';
import type { ProgramNodeId } from './identity.js';
import type {
  ProgramRepeatCondition,
  ProgramValueMapping,
  ProgramValueSelector,
} from './selectors.js';

export type ProgramRegionExit = {
  readonly outcome: string;
  readonly outputSchema: ValueSchema;
};

export type ProgramRegion = {
  readonly id: ProgramNodeId;
  readonly inputSchema: ValueSchema;
  readonly entry: ProgramNodeId;
  readonly outputSchema: ValueSchema;
  readonly exits: readonly [ProgramRegionExit, ...ProgramRegionExit[]];
  readonly nodes: readonly [ProgramNode, ...ProgramNode[]];
};

export type ProgramActivityNode = {
  readonly kind: 'activity';
  readonly id: ProgramNodeId;
  readonly activityKind: 'agent' | 'script';
  readonly requirementKey: string;
  readonly input: ProgramValueMapping;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
  readonly routes: {
    readonly succeeded: ProgramNodeId;
    readonly failed: ProgramNodeId;
    readonly cancelled: ProgramNodeId;
  };
};

export type ProgramChoiceNode = {
  readonly kind: 'choice';
  readonly id: ProgramNodeId;
  readonly selector: ProgramValueSelector;
  readonly cases: readonly [
    { readonly key: string; readonly when: ChoiceDomain; readonly target: ProgramNodeId },
    ...{ readonly key: string; readonly when: ChoiceDomain; readonly target: ProgramNodeId }[],
  ];
  readonly otherwise: ProgramNodeId | null;
};

export type ProgramCallNode = {
  readonly kind: 'call';
  readonly id: ProgramNodeId;
  readonly module: string;
  readonly input: ProgramValueMapping;
  readonly outputSchema: ValueSchema;
  readonly routes: {
    readonly outcomes: readonly [
      { readonly outcome: string; readonly target: ProgramNodeId },
      ...{ readonly outcome: string; readonly target: ProgramNodeId }[],
    ];
    readonly failed: ProgramNodeId;
    readonly cancelled: ProgramNodeId;
  };
};

export type GenericParallelBranchResult =
  | { readonly status: 'completed'; readonly outcome: string; readonly output: JsonValue }
  | { readonly status: 'failed'; readonly failure: PipelineFailure }
  | { readonly status: 'cancelled' };

export type GenericParallelOutput = {
  readonly classification: 'completed' | 'impossible' | 'failed' | 'cancelled';
  readonly branches: Readonly<Record<string, GenericParallelBranchResult>>;
};

export type VoteParallelBranchResult =
  | { readonly status: 'vote'; readonly vote: 'approve' | 'reject' | 'abstain' }
  | { readonly status: 'failed'; readonly failure: PipelineFailure }
  | { readonly status: 'cancelled' };

export type VoteParallelOutput = {
  readonly classification:
    | 'approved'
    | 'rejected'
    | 'inconclusive'
    | 'participantFailed'
    | 'cancelled';
  readonly votes: Readonly<Record<string, VoteParallelBranchResult>>;
};

export type ProgramParallelBranch = {
  readonly key: string;
  readonly input: ProgramValueMapping;
  readonly region: ProgramRegion;
  readonly exits: readonly [
    RegionExitClassification<ParallelBranchClassification>,
    ...RegionExitClassification<ParallelBranchClassification>[],
  ];
};

export type ProgramVoteBranch = {
  readonly key: string;
  readonly bindingKey: string;
  readonly input: ProgramValueMapping;
  readonly region: ProgramRegion;
};

export type ProgramParallelNode =
  | {
      readonly kind: 'parallel';
      readonly id: ProgramNodeId;
      readonly mode: 'generic';
      readonly branches: readonly [
        ProgramParallelBranch,
        ProgramParallelBranch,
        ...ProgramParallelBranch[],
      ];
      readonly policy: ParallelPolicy;
      readonly remaining: 'drain' | 'cancel';
      readonly next: ProgramNodeId;
    }
  | {
      readonly kind: 'parallel';
      readonly id: ProgramNodeId;
      readonly mode: 'votes';
      readonly branches: readonly [ProgramVoteBranch, ...ProgramVoteBranch[]];
      readonly policy: ConsensusPolicy;
      readonly remaining: 'drain' | 'cancel';
      readonly next: ProgramNodeId;
    };

export type ProgramRepeatNode = {
  readonly kind: 'repeat';
  readonly id: ProgramNodeId;
  readonly maximumIterations: number;
  readonly initialInput: ProgramValueMapping;
  readonly nextInput: ProgramValueMapping;
  readonly body: ProgramRegion;
  readonly bodyExits: readonly [
    RegionExitClassification<'value' | 'failed' | 'cancelled'>,
    ...RegionExitClassification<'value' | 'failed' | 'cancelled'>[],
  ];
  readonly continueWhen: ProgramRepeatCondition;
  readonly output: ProgramValueMapping;
  readonly outputSchema: ValueSchema;
  readonly routes: {
    readonly completed: ProgramNodeId;
    readonly exhausted: ProgramNodeId;
    readonly failed: ProgramNodeId;
    readonly cancelled: ProgramNodeId;
  };
};

export type ProgramMapNode = {
  readonly kind: 'map';
  readonly id: ProgramNodeId;
  readonly items: ProgramValueSelector;
  readonly itemKeyPointer: JsonPointer;
  readonly maximumItems: number;
  readonly maximumConcurrency: number;
  readonly bodyInput: ProgramValueMapping;
  readonly body: ProgramRegion;
  readonly bodyExits: readonly [
    RegionExitClassification<'completed' | 'failed' | 'cancelled'>,
    ...RegionExitClassification<'completed' | 'failed' | 'cancelled'>[],
  ];
  readonly failure:
    | { readonly kind: 'collect' }
    | { readonly kind: 'failFast'; readonly remaining: 'drain' | 'cancel' };
  readonly routes: {
    readonly completed: ProgramNodeId;
    readonly failed: ProgramNodeId;
    readonly cancelled: ProgramNodeId;
  };
};

export type ProgramWaitNode = {
  readonly kind: 'wait';
  readonly id: ProgramNodeId;
  readonly wait:
    | { readonly kind: 'duration'; readonly durationMs: number }
    | {
        readonly kind: 'signal';
        readonly signal: string;
        readonly payloadSchema: ValueSchema | null;
      };
  readonly routes: { readonly completed: ProgramNodeId; readonly cancelled: ProgramNodeId };
};

export type ProgramHumanGateNode = {
  readonly kind: 'humanGate';
  readonly id: ProgramNodeId;
  readonly subject: string;
  readonly answers: readonly [string, ...string[]];
  readonly authorizationRequirements: readonly string[];
  readonly payloadSchema: ValueSchema | null;
  readonly deadline: { readonly afterMs: number; readonly target: ProgramNodeId } | null;
  readonly routes: {
    readonly answers: readonly [
      { readonly answer: string; readonly target: ProgramNodeId },
      ...{ readonly answer: string; readonly target: ProgramNodeId }[],
    ];
    readonly cancelled: ProgramNodeId;
  };
};

export type ProgramEndNode = {
  readonly kind: 'end';
  readonly id: ProgramNodeId;
  readonly outcome: string;
  readonly output: ProgramValueMapping;
};

export type ProgramNode =
  | ProgramActivityNode
  | ProgramChoiceNode
  | ProgramCallNode
  | ProgramParallelNode
  | ProgramRepeatNode
  | ProgramMapNode
  | ProgramWaitNode
  | ProgramHumanGateNode
  | ProgramEndNode;
