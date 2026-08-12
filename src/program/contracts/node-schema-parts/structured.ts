import { Type } from 'typebox';

import {
  ConsensusPolicySchema,
  IdentifierSchema,
  JsonPointerSchema,
  PIPELINE_LIMITS,
  ParallelPolicySchema,
  ValueSchemaSchema,
  atLeastTwoSchema,
  closedObject,
  nonEmptyArraySchema,
  readonlySchema,
} from '../../../foundation/index.js';
import {
  ProgramRepeatConditionSchema,
  ProgramValueMappingSchema,
  ProgramValueSelectorSchema,
} from '../selectors.js';
import {
  ProgramNodeIdSchema,
  genericBranchClassificationSchema,
  regionExitClassificationSchema,
  stringLiterals,
  targetRoutes,
} from './common.js';

const programParallelBranch = closedObject({
  key: readonlySchema(IdentifierSchema),
  input: readonlySchema(ProgramValueMappingSchema),
  region: readonlySchema(Type.Ref('ProgramRegion')),
  exits: readonlySchema(
    nonEmptyArraySchema(regionExitClassificationSchema(genericBranchClassificationSchema)),
  ),
});

const programVoteBranch = closedObject({
  key: readonlySchema(IdentifierSchema),
  bindingKey: readonlySchema(IdentifierSchema),
  input: readonlySchema(ProgramValueMappingSchema),
  region: readonlySchema(Type.Ref('ProgramRegion')),
});

const genericParallel = closedObject({
  kind: readonlySchema(Type.Literal('parallel')),
  id: readonlySchema(ProgramNodeIdSchema),
  mode: readonlySchema(Type.Literal('generic')),
  branches: readonlySchema(
    atLeastTwoSchema(programParallelBranch, PIPELINE_LIMITS.structured.participants),
  ),
  policy: readonlySchema(ParallelPolicySchema),
  remaining: readonlySchema(Type.Union([Type.Literal('drain'), Type.Literal('cancel')])),
  next: readonlySchema(ProgramNodeIdSchema),
});

const voteParallel = closedObject({
  kind: readonlySchema(Type.Literal('parallel')),
  id: readonlySchema(ProgramNodeIdSchema),
  mode: readonlySchema(Type.Literal('votes')),
  branches: readonlySchema(
    nonEmptyArraySchema(programVoteBranch, PIPELINE_LIMITS.structured.participants),
  ),
  policy: readonlySchema(ConsensusPolicySchema),
  remaining: readonlySchema(Type.Union([Type.Literal('drain'), Type.Literal('cancel')])),
  next: readonlySchema(ProgramNodeIdSchema),
});

export const structuredNodeSchemas = {
  ProgramParallelNode: Type.Union([genericParallel, voteParallel]),
  ProgramRepeatNode: closedObject({
    kind: readonlySchema(Type.Literal('repeat')),
    id: readonlySchema(ProgramNodeIdSchema),
    maximumIterations: readonlySchema(
      Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.structured.repeatIterations }),
    ),
    initialInput: readonlySchema(ProgramValueMappingSchema),
    nextInput: readonlySchema(ProgramValueMappingSchema),
    body: readonlySchema(Type.Ref('ProgramRegion')),
    bodyExits: readonlySchema(
      nonEmptyArraySchema(
        regionExitClassificationSchema(stringLiterals(['value', 'failed', 'cancelled'])),
      ),
    ),
    continueWhen: readonlySchema(ProgramRepeatConditionSchema),
    output: readonlySchema(ProgramValueMappingSchema),
    outputSchema: readonlySchema(ValueSchemaSchema),
    routes: readonlySchema(targetRoutes(['completed', 'exhausted', 'failed', 'cancelled'])),
  }),
  ProgramMapNode: closedObject({
    kind: readonlySchema(Type.Literal('map')),
    id: readonlySchema(ProgramNodeIdSchema),
    items: readonlySchema(ProgramValueSelectorSchema),
    itemKeyPointer: readonlySchema(JsonPointerSchema),
    maximumItems: readonlySchema(
      Type.Integer({ minimum: 0, maximum: PIPELINE_LIMITS.structured.mapItems }),
    ),
    maximumConcurrency: readonlySchema(
      Type.Integer({ minimum: 1, maximum: PIPELINE_LIMITS.structured.mapItems }),
    ),
    bodyInput: readonlySchema(ProgramValueMappingSchema),
    body: readonlySchema(Type.Ref('ProgramRegion')),
    bodyExits: readonlySchema(
      nonEmptyArraySchema(
        regionExitClassificationSchema(stringLiterals(['completed', 'failed', 'cancelled'])),
      ),
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
    routes: readonlySchema(targetRoutes(['completed', 'failed', 'cancelled'])),
  }),
};
