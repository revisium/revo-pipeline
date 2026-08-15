import {
  isJsonPointer,
  readOwnDataValue,
  reflectOwnKeys,
  type JsonPointer,
  type JsonValue,
  type PipelineFailure,
} from '../../../foundation/index.js';
import type { NodeTerminalResult, RegionTerminalResult } from '../../contracts/results.js';

export const failure = (code: string, path: JsonPointer = ''): PipelineFailure =>
  Object.freeze({ code, path });

export const failedNode = (value: PipelineFailure): NodeTerminalResult =>
  Object.freeze({ status: 'failed', failure: value });

export const cancelledNode = (): NodeTerminalResult => Object.freeze({ status: 'cancelled' });

export const succeededNode = (output: JsonValue): NodeTerminalResult =>
  Object.freeze({ status: 'succeeded' as const, output });

export const regionFailure = (value: PipelineFailure): RegionTerminalResult =>
  Object.freeze({ status: 'failed', failure: value });

export const cleanupNodeResult = (result: RegionTerminalResult): NodeTerminalResult =>
  result.status === 'failed' ? failedNode(result.failure) : cancelledNode();

export const cleanupRegionResult = (result: NodeTerminalResult): RegionTerminalResult =>
  result.status === 'failed'
    ? regionFailure(result.failure)
    : Object.freeze({ status: 'cancelled' });

export const readPipelineFailure = (value: JsonValue): PipelineFailure => {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value);
  const keys = record ? reflectOwnKeys(value) : null;
  const code = record ? readOwnDataValue(value, 'code') : undefined;
  const path = record ? readOwnDataValue(value, 'path') : undefined;
  if (
    keys?.length === 2 &&
    typeof code === 'string' &&
    typeof path === 'string' &&
    isJsonPointer(path)
  ) {
    return Object.freeze({ code, path });
  }
  return failure('DATA_SCHEMA_MISMATCH');
};
