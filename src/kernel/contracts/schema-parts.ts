import { Type, type Static } from 'typebox';

import {
  DigestSchema,
  JsonValueSchema,
  PIPELINE_LIMITS,
  closedObject,
  readonlySchema,
  type Digest,
} from '../../foundation/index.js';
import { NodeTerminalResultSchema } from './results.js';
import type { NodeTerminalResult } from './results.js';

const NodeResultsSchema = Type.Unsafe<Readonly<Record<Digest, NodeTerminalResult>>>(
  Type.Record(DigestSchema, NodeTerminalResultSchema, {
    maxProperties: PIPELINE_LIMITS.sourcePackage.nodes,
  }),
);

export const frameBaseProperties = {
  key: readonlySchema(DigestSchema),
  parentFrameKey: readonlySchema(Type.Union([DigestSchema, Type.Null()])),
  scopeInput: readonlySchema(JsonValueSchema),
  nodeResults: readonlySchema(NodeResultsSchema),
};

export const MachineFrameBaseSchema = closedObject(frameBaseProperties);
export type MachineFrameBase = Static<typeof MachineFrameBaseSchema>;
