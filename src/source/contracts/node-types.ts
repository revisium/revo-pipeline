import type { JsonPointer } from '../../foundation/index.js';
import type {
  ActivityRoutes,
  AgentSlotStrategy,
  ConsensusPolicy,
  ConsensusRoutes,
  ParallelBranchClassification,
  ParallelPolicy,
  ParallelRoutes,
  RegionExitClassification,
} from './policy-contracts.js';
import type {
  ChoiceDomain,
  RepeatCondition,
  ValueMapping,
  ValueSchema,
  ValueSelector,
} from './value-contracts.js';

export type ExactSourceRegionExit = {
  readonly outcome: string;
  readonly outputSchema: ValueSchema;
};

export type ExactSourceRegion = {
  readonly key: string;
  readonly inputSchema?: ValueSchema;
  readonly entry: string;
  readonly outputSchema: ValueSchema;
  readonly exits: readonly [ExactSourceRegionExit, ...ExactSourceRegionExit[]];
  readonly nodes: readonly [ExactSourceNode, ...ExactSourceNode[]];
};

type ExactAgentSourceNode = {
  readonly kind: 'agent';
  readonly key: string;
  readonly slotKey: string;
  readonly strategies: readonly [AgentSlotStrategy, ...AgentSlotStrategy[]];
  readonly input: ValueMapping;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
};

type ExactScriptSourceNode = {
  readonly kind: 'script';
  readonly key: string;
  readonly requirementKey: string;
  readonly script: { readonly key: string; readonly revision: number };
  readonly input: ValueMapping;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
  readonly routes: ActivityRoutes;
};

type ExactEffectSourceNode = {
  readonly kind: 'effect';
  readonly key: string;
  readonly requirementKey: string;
  readonly effectKey: string;
  readonly input: ValueMapping;
  readonly inputSchema: ValueSchema;
  readonly outputSchema: ValueSchema;
  readonly routes: ActivityRoutes;
};

type ExactChoiceSourceNode = {
  readonly kind: 'choice';
  readonly key: string;
  readonly selector: ValueSelector;
  readonly cases: readonly [
    { readonly key: string; readonly when: ChoiceDomain; readonly target: string },
    ...{ readonly key: string; readonly when: ChoiceDomain; readonly target: string }[],
  ];
  readonly otherwise: string | null;
};

type ExactParallelSourceNode = {
  readonly kind: 'parallel';
  readonly key: string;
  readonly branches: readonly [
    ExactParallelSourceBranch,
    ExactParallelSourceBranch,
    ...ExactParallelSourceBranch[],
  ];
  readonly policy: ParallelPolicy;
  readonly remaining: 'drain' | 'cancel';
  readonly routes: ParallelRoutes;
};

export type ExactParallelSourceBranch = {
  readonly key: string;
  readonly input: ValueMapping;
  readonly region: ExactSourceRegion;
  readonly exits: readonly [
    RegionExitClassification<ParallelBranchClassification>,
    ...RegionExitClassification<ParallelBranchClassification>[],
  ];
};

type ExactRepeatSourceNode = {
  readonly kind: 'repeat';
  readonly key: string;
  readonly maximumIterations: number;
  readonly initialInput: ValueMapping;
  readonly nextInput: ValueMapping;
  readonly body: ExactSourceRegion;
  readonly bodyExits: readonly [
    RegionExitClassification<'value' | 'failed' | 'cancelled'>,
    ...RegionExitClassification<'value' | 'failed' | 'cancelled'>[],
  ];
  readonly continueWhen: RepeatCondition;
  readonly output: ValueMapping;
  readonly outputSchema: ValueSchema;
  readonly routes: {
    readonly completed: string;
    readonly exhausted: string;
    readonly failed: string;
    readonly cancelled: string;
  };
};

type ExactMapSourceNode = {
  readonly kind: 'map';
  readonly key: string;
  readonly items: ValueSelector;
  readonly itemKeyPointer: JsonPointer;
  readonly maximumItems: number;
  readonly maximumConcurrency: number;
  readonly bodyInput: ValueMapping;
  readonly body: ExactSourceRegion;
  readonly bodyExits: readonly [
    RegionExitClassification<'completed' | 'failed' | 'cancelled'>,
    ...RegionExitClassification<'completed' | 'failed' | 'cancelled'>[],
  ];
  readonly failure:
    | { readonly kind: 'collect' }
    | { readonly kind: 'failFast'; readonly remaining: 'drain' | 'cancel' };
  readonly routes: {
    readonly completed: string;
    readonly failed: string;
    readonly cancelled: string;
  };
};

type ExactWaitSourceNode = {
  readonly kind: 'wait';
  readonly key: string;
  readonly wait:
    | { readonly kind: 'duration'; readonly durationMs: number }
    | {
        readonly kind: 'signal';
        readonly signal: string;
        readonly payloadSchema: ValueSchema | null;
      };
  readonly routes: { readonly completed: string; readonly cancelled: string };
};

type ExactHumanGateSourceNode = {
  readonly kind: 'humanGate';
  readonly key: string;
  readonly subject: string;
  readonly answers: readonly [string, ...string[]];
  readonly authorizationRequirements: readonly string[];
  readonly routes: {
    readonly answers: readonly [
      { readonly answer: string; readonly target: string },
      ...{ readonly answer: string; readonly target: string }[],
    ];
    readonly conflict: string;
    readonly deadline: string;
    readonly cancelled: string;
  };
};

type ExactConsensusSourceNode = {
  readonly kind: 'consensus';
  readonly key: string;
  readonly participants: readonly [
    ExactExplicitConsensusParticipant,
    ExactExplicitConsensusParticipant,
    ...ExactExplicitConsensusParticipant[],
  ];
  readonly policy: ConsensusPolicy;
  readonly remaining: 'drain' | 'cancel';
  readonly routes: ConsensusRoutes;
};

export type ExactExplicitConsensusParticipant = {
  readonly key: string;
  readonly bindingKey: string;
  readonly input: ValueMapping;
  readonly inputSchema: ValueSchema;
};

type ExactCallSourceNode = {
  readonly kind: 'call';
  readonly key: string;
  readonly module: string;
  readonly input: ValueMapping;
  readonly outputSchema: ValueSchema;
  readonly routes: {
    readonly outcomes: readonly [
      { readonly outcome: string; readonly target: string },
      ...{ readonly outcome: string; readonly target: string }[],
    ];
    readonly failed: string;
    readonly cancelled: string;
  };
};

type ExactEndSourceNode = {
  readonly kind: 'end';
  readonly key: string;
  readonly outcome: string;
  readonly output: ValueMapping;
};

export type ExactSourceNode =
  | ExactAgentSourceNode
  | ExactScriptSourceNode
  | ExactEffectSourceNode
  | ExactChoiceSourceNode
  | ExactParallelSourceNode
  | ExactRepeatSourceNode
  | ExactMapSourceNode
  | ExactWaitSourceNode
  | ExactHumanGateSourceNode
  | ExactConsensusSourceNode
  | ExactCallSourceNode
  | ExactEndSourceNode;
