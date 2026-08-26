import { Type, type Static } from 'typebox';

import {
  PIPELINE_LIMITS,
  ParallelPolicySchema,
  ScriptPinSchema,
  closedObject,
} from '../../foundation/index.js';
import type {
  ExactParallelSourceBranch,
  ExactSourceNode,
  ExactSourceRegion,
  ExactSourceRegionExit,
} from './node-types.js';
import {
  ActivityRoutesSchema,
  AgentSlotStrategySchema,
  ConsensusPolicySchema,
  ConsensusRoutesSchema,
} from './policy-contracts.js';
import {
  DisplayStringSchema,
  IdentifierSchema,
  JsonPointerSchema,
  JsonValueSchema,
  atLeastTwoSchema,
  immutableArraySchema,
  nonEmptyArraySchema,
  optionalReadonlySchema,
  readonlySchema,
} from './schema-builders.js';
import {
  ChoiceDomainSchema,
  RepeatConditionSchema,
  ValueMappingSchema,
  ValueSchemaSchema,
  ValueSelectorSchema,
} from './value-contracts.js';

export const AgentActivityInputValueSchema: import('../../foundation/index.js').ValueSchema =
  Object.freeze({
    type: 'object' as const,
    properties: Object.freeze({
      prompt: Object.freeze({ type: 'string' as const }),
      metadata: Object.freeze({
        type: 'object' as const,
        properties: {},
        required: [],
        additionalProperties: false,
      }),
    }),
    required: Object.freeze(['prompt']),
    additionalProperties: false,
  });

const regionExitSchema = closedObject({
  outcome: readonlySchema(IdentifierSchema),
  outputSchema: readonlySchema(ValueSchemaSchema),
});

const regionExitClassificationSchema = (classifications: readonly string[]) =>
  closedObject({
    outcome: readonlySchema(IdentifierSchema),
    classification: readonlySchema(Type.Union(classifications.map((value) => Type.Literal(value)))),
  });

const agentSourceNodeSchema = closedObject({
  kind: readonlySchema(Type.Literal('agent')),
  id: readonlySchema(IdentifierSchema),
  strategies: readonlySchema(nonEmptyArraySchema(AgentSlotStrategySchema, 2)),
  input: readonlySchema(ValueMappingSchema),
  inputSchema: readonlySchema(ValueSchemaSchema),
  outputSchema: readonlySchema(ValueSchemaSchema),
});

const scriptSourceNodeSchema = closedObject({
  kind: readonlySchema(Type.Literal('script')),
  id: readonlySchema(IdentifierSchema),
  requirementKey: readonlySchema(IdentifierSchema),
  script: readonlySchema(ScriptPinSchema),
  input: readonlySchema(ValueMappingSchema),
  inputSchema: readonlySchema(ValueSchemaSchema),
  outputSchema: readonlySchema(ValueSchemaSchema),
  routes: readonlySchema(ActivityRoutesSchema),
});

const choiceSourceNodeSchema = closedObject({
  kind: readonlySchema(Type.Literal('choice')),
  id: readonlySchema(IdentifierSchema),
  selector: readonlySchema(ValueSelectorSchema),
  cases: readonlySchema(
    nonEmptyArraySchema(
      closedObject({
        key: readonlySchema(IdentifierSchema),
        when: readonlySchema(ChoiceDomainSchema),
        target: readonlySchema(IdentifierSchema),
      }),
    ),
  ),
  otherwise: readonlySchema(Type.Union([IdentifierSchema, Type.Null()])),
});

const parallelSourceNodeSchema = closedObject({
  kind: readonlySchema(Type.Literal('parallel')),
  id: readonlySchema(IdentifierSchema),
  branches: readonlySchema(
    atLeastTwoSchema(
      closedObject({
        key: readonlySchema(IdentifierSchema),
        input: readonlySchema(ValueMappingSchema),
        region: readonlySchema(Type.Ref('SourceRegion')),
        exits: readonlySchema(
          nonEmptyArraySchema(
            regionExitClassificationSchema(['qualifies', 'doesNotQualify', 'failed', 'cancelled']),
          ),
        ),
      }),
      PIPELINE_LIMITS.structured.participants,
    ),
  ),
  policy: readonlySchema(ParallelPolicySchema),
  remaining: readonlySchema(Type.Union([Type.Literal('drain'), Type.Literal('cancel')])),
  routes: readonlySchema(
    closedObject({
      completed: readonlySchema(IdentifierSchema),
      impossible: readonlySchema(IdentifierSchema),
      failed: readonlySchema(IdentifierSchema),
      cancelled: readonlySchema(IdentifierSchema),
    }),
  ),
});

const repeatSourceNodeSchema = closedObject({
  kind: readonlySchema(Type.Literal('repeat')),
  id: readonlySchema(IdentifierSchema),
  maximumIterations: readonlySchema(
    Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.structured.repeatIterations }),
  ),
  initialInput: readonlySchema(ValueMappingSchema),
  nextInput: readonlySchema(ValueMappingSchema),
  body: readonlySchema(Type.Ref('SourceRegion')),
  bodyExits: readonlySchema(
    nonEmptyArraySchema(regionExitClassificationSchema(['value', 'failed', 'cancelled'])),
  ),
  continueWhen: readonlySchema(RepeatConditionSchema),
  output: readonlySchema(ValueMappingSchema),
  outputSchema: readonlySchema(ValueSchemaSchema),
  routes: readonlySchema(
    closedObject({
      completed: readonlySchema(IdentifierSchema),
      exhausted: readonlySchema(IdentifierSchema),
      failed: readonlySchema(IdentifierSchema),
      cancelled: readonlySchema(IdentifierSchema),
    }),
  ),
});

const mapSourceNodeSchema = closedObject({
  kind: readonlySchema(Type.Literal('map')),
  id: readonlySchema(IdentifierSchema),
  items: readonlySchema(ValueSelectorSchema),
  itemKeyPointer: readonlySchema(JsonPointerSchema),
  maximumItems: readonlySchema(
    Type.Integer({ minimum: 0, maximum: PIPELINE_LIMITS.structured.mapItems }),
  ),
  maximumConcurrency: readonlySchema(
    Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.structured.mapItems }),
  ),
  bodyInput: readonlySchema(ValueMappingSchema),
  body: readonlySchema(Type.Ref('SourceRegion')),
  bodyExits: readonlySchema(
    nonEmptyArraySchema(regionExitClassificationSchema(['completed', 'failed', 'cancelled'])),
  ),
  failure: readonlySchema(
    Type.Union([
      closedObject({ kind: readonlySchema(Type.Literal('collect')) }),
      closedObject({
        kind: readonlySchema(Type.Literal('failFast')),
        remaining: readonlySchema(Type.Union([Type.Literal('drain'), Type.Literal('cancel')])),
      }),
    ]),
  ),
  routes: readonlySchema(
    closedObject({
      completed: readonlySchema(IdentifierSchema),
      failed: readonlySchema(IdentifierSchema),
      cancelled: readonlySchema(IdentifierSchema),
    }),
  ),
});

const waitSourceNodeSchema = closedObject({
  kind: readonlySchema(Type.Literal('wait')),
  id: readonlySchema(IdentifierSchema),
  wait: readonlySchema(
    Type.Union([
      closedObject({
        kind: readonlySchema(Type.Literal('duration')),
        durationMs: readonlySchema(Type.Integer({ minimum: 0 })),
      }),
      closedObject({
        kind: readonlySchema(Type.Literal('signal')),
        signal: readonlySchema(IdentifierSchema),
        payloadSchema: readonlySchema(Type.Union([ValueSchemaSchema, Type.Null()])),
      }),
    ]),
  ),
  routes: readonlySchema(
    closedObject({
      completed: readonlySchema(IdentifierSchema),
      cancelled: readonlySchema(IdentifierSchema),
    }),
  ),
});

const humanGateSourceNodeSchema = closedObject({
  kind: readonlySchema(Type.Literal('humanGate')),
  id: readonlySchema(IdentifierSchema),
  subject: readonlySchema(DisplayStringSchema),
  answers: readonlySchema(nonEmptyArraySchema(IdentifierSchema)),
  authorizationRequirements: readonlySchema(immutableArraySchema(IdentifierSchema)),
  payloadSchema: readonlySchema(Type.Union([ValueSchemaSchema, Type.Null()])),
  deadline: readonlySchema(
    Type.Union([
      closedObject({
        afterMs: readonlySchema(Type.Integer({ minimum: 0 })),
        target: readonlySchema(IdentifierSchema),
      }),
      Type.Null(),
    ]),
  ),
  routes: readonlySchema(
    closedObject({
      answers: readonlySchema(
        nonEmptyArraySchema(
          closedObject({
            answer: readonlySchema(IdentifierSchema),
            target: readonlySchema(IdentifierSchema),
          }),
        ),
      ),
      cancelled: readonlySchema(IdentifierSchema),
    }),
  ),
});

const consensusSourceNodeSchema = closedObject({
  kind: readonlySchema(Type.Literal('consensus')),
  id: readonlySchema(IdentifierSchema),
  participants: readonlySchema(
    atLeastTwoSchema(
      closedObject({
        key: readonlySchema(IdentifierSchema),
        bindingKey: readonlySchema(IdentifierSchema),
        input: readonlySchema(ValueMappingSchema),
        inputSchema: readonlySchema(ValueSchemaSchema),
      }),
      PIPELINE_LIMITS.structured.participants,
    ),
  ),
  policy: readonlySchema(ConsensusPolicySchema),
  remaining: readonlySchema(Type.Union([Type.Literal('drain'), Type.Literal('cancel')])),
  routes: readonlySchema(ConsensusRoutesSchema),
});

const callSourceNodeSchema = closedObject({
  kind: readonlySchema(Type.Literal('call')),
  id: readonlySchema(IdentifierSchema),
  module: readonlySchema(IdentifierSchema),
  input: readonlySchema(ValueMappingSchema),
  outputSchema: readonlySchema(ValueSchemaSchema),
  routes: readonlySchema(
    closedObject({
      outcomes: readonlySchema(
        nonEmptyArraySchema(
          closedObject({
            outcome: readonlySchema(IdentifierSchema),
            target: readonlySchema(IdentifierSchema),
          }),
        ),
      ),
      failed: readonlySchema(IdentifierSchema),
      cancelled: readonlySchema(IdentifierSchema),
    }),
  ),
});

const endSourceNodeSchema = closedObject({
  kind: readonlySchema(Type.Literal('end')),
  id: readonlySchema(IdentifierSchema),
  outcome: readonlySchema(IdentifierSchema),
  output: readonlySchema(ValueMappingSchema),
});

const sourceDefinitions = {
  SourceRegionExit: regionExitSchema,
  AgentSourceNode: agentSourceNodeSchema,
  ScriptSourceNode: scriptSourceNodeSchema,
  ChoiceSourceNode: choiceSourceNodeSchema,
  ParallelSourceNode: parallelSourceNodeSchema,
  RepeatSourceNode: repeatSourceNodeSchema,
  MapSourceNode: mapSourceNodeSchema,
  WaitSourceNode: waitSourceNodeSchema,
  HumanGateSourceNode: humanGateSourceNodeSchema,
  ConsensusSourceNode: consensusSourceNodeSchema,
  CallSourceNode: callSourceNodeSchema,
  EndSourceNode: endSourceNodeSchema,
  SourceNode: Type.Union([
    Type.Ref('AgentSourceNode'),
    Type.Ref('ScriptSourceNode'),
    Type.Ref('ChoiceSourceNode'),
    Type.Ref('ParallelSourceNode'),
    Type.Ref('RepeatSourceNode'),
    Type.Ref('MapSourceNode'),
    Type.Ref('WaitSourceNode'),
    Type.Ref('HumanGateSourceNode'),
    Type.Ref('ConsensusSourceNode'),
    Type.Ref('CallSourceNode'),
    Type.Ref('EndSourceNode'),
  ]),
  SourceRegion: closedObject({
    key: readonlySchema(IdentifierSchema),
    inputSchema: optionalReadonlySchema(ValueSchemaSchema),
    entry: readonlySchema(IdentifierSchema),
    outputSchema: readonlySchema(ValueSchemaSchema),
    exits: readonlySchema(nonEmptyArraySchema(Type.Ref('SourceRegionExit'))),
    nodes: readonlySchema(
      nonEmptyArraySchema(Type.Ref('SourceNode'), PIPELINE_LIMITS.sourcePackage.nodes),
    ),
  }),
};

export const SourceRegionSchema = Type.Unsafe<ExactSourceRegion>(
  Type.Cyclic(sourceDefinitions, 'SourceRegion'),
);
export const SourceNodeSchema = Type.Unsafe<ExactSourceNode>(
  Type.Cyclic(sourceDefinitions, 'SourceNode'),
);

export type SourceRegionExit = ExactSourceRegionExit;
export type SourceRegion = Static<typeof SourceRegionSchema>;
export const SourceNodeIdSchema = IdentifierSchema;
export type SourceNodeId = Static<typeof SourceNodeIdSchema>;
export type SourceNode = Static<typeof SourceNodeSchema>;
export type AgentSourceNode = Extract<SourceNode, { readonly kind: 'agent' }>;
export type ScriptSourceNode = Extract<SourceNode, { readonly kind: 'script' }>;
export type ChoiceSourceNode = Extract<SourceNode, { readonly kind: 'choice' }>;
export type ParallelSourceNode = Extract<SourceNode, { readonly kind: 'parallel' }>;
export type RepeatSourceNode = Extract<SourceNode, { readonly kind: 'repeat' }>;
export type MapSourceNode = Extract<SourceNode, { readonly kind: 'map' }>;
export type WaitSourceNode = Extract<SourceNode, { readonly kind: 'wait' }>;
export type HumanGateSourceNode = Extract<SourceNode, { readonly kind: 'humanGate' }>;
export type ConsensusSourceNode = Extract<SourceNode, { readonly kind: 'consensus' }>;
export type CallSourceNode = Extract<SourceNode, { readonly kind: 'call' }>;
export type EndSourceNode = Extract<SourceNode, { readonly kind: 'end' }>;
export type ParallelSourceBranch = ExactParallelSourceBranch;
export type ExplicitConsensusParticipant =
  import('./node-types.js').ExactExplicitConsensusParticipant;
export type AgentActivityInput = {
  readonly prompt: string;
  readonly metadata?: Readonly<Record<string, import('../../foundation/index.js').JsonValue>>;
};

export const AgentActivityInputSchema = Type.Unsafe<AgentActivityInput>(
  closedObject({
    prompt: readonlySchema(DisplayStringSchema),
    metadata: optionalReadonlySchema(Type.Record(Type.String(), JsonValueSchema)),
  }),
);
