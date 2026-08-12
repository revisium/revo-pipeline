import { Type } from 'typebox';

import {
  IdentifierSchema,
  PIPELINE_LIMITS,
  ValueSchemaSchema,
  closedObject,
  nonEmptyArraySchema,
  readonlySchema,
} from '../../foundation/index.js';
import { ProgramNodeIdSchema } from './node-schema-parts/common.js';
import { directNodeSchemas } from './node-schema-parts/direct.js';
import { structuredNodeSchemas } from './node-schema-parts/structured.js';
import type { ProgramNode, ProgramRegion } from './node-types.js';

const programRegionExit = closedObject({
  outcome: readonlySchema(IdentifierSchema),
  outputSchema: readonlySchema(ValueSchemaSchema),
});

const programDefinitions = {
  ProgramRegionExit: programRegionExit,
  ...directNodeSchemas,
  ...structuredNodeSchemas,
  ProgramNode: Type.Union([
    Type.Ref('ProgramActivityNode'),
    Type.Ref('ProgramChoiceNode'),
    Type.Ref('ProgramCallNode'),
    Type.Ref('ProgramParallelNode'),
    Type.Ref('ProgramRepeatNode'),
    Type.Ref('ProgramMapNode'),
    Type.Ref('ProgramWaitNode'),
    Type.Ref('ProgramHumanGateNode'),
    Type.Ref('ProgramEndNode'),
  ]),
  ProgramRegion: closedObject({
    id: readonlySchema(ProgramNodeIdSchema),
    inputSchema: readonlySchema(ValueSchemaSchema),
    entry: readonlySchema(ProgramNodeIdSchema),
    outputSchema: readonlySchema(ValueSchemaSchema),
    exits: readonlySchema(nonEmptyArraySchema(Type.Ref('ProgramRegionExit'))),
    nodes: readonlySchema(
      nonEmptyArraySchema(Type.Ref('ProgramNode'), PIPELINE_LIMITS.sourcePackage.totalActivities),
    ),
  }),
};

export const ProgramRegionSchema = Type.Unsafe<ProgramRegion>(
  Type.Cyclic(programDefinitions, 'ProgramRegion'),
);
export const ProgramNodeSchema = Type.Unsafe<ProgramNode>(
  Type.Cyclic(programDefinitions, 'ProgramNode'),
);

export type {
  GenericParallelBranchResult,
  GenericParallelOutput,
  ProgramActivityNode,
  ProgramCallNode,
  ProgramChoiceNode,
  ProgramEndNode,
  ProgramHumanGateNode,
  ProgramMapNode,
  ProgramNode,
  ProgramParallelBranch,
  ProgramParallelNode,
  ProgramRegion,
  ProgramRegionExit,
  ProgramRepeatNode,
  ProgramVoteBranch,
  ProgramWaitNode,
  VoteParallelBranchResult,
  VoteParallelOutput,
} from './node-types.js';
