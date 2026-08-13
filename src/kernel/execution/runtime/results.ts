import {
  isJsonPointer,
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
  const code =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Reflect.getOwnPropertyDescriptor(value, 'code')
      : undefined;
  const path =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Reflect.getOwnPropertyDescriptor(value, 'path')
      : undefined;
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === 2 &&
    code !== undefined &&
    'value' in code &&
    typeof code.value === 'string' &&
    path !== undefined &&
    'value' in path &&
    typeof path.value === 'string' &&
    isJsonPointer(path.value)
  ) {
    return Object.freeze({ code: code.value, path: path.value });
  }
  return failure('DATA_SCHEMA_MISMATCH');
};
