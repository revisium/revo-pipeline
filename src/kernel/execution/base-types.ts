import type { Digest } from '../../foundation/index.js';
import type { PipelineCommand } from '../contracts/commands.js';
import type { MachineFault } from '../contracts/faults.js';
import type { PipelineState } from '../contracts/state.js';

export type BaseBoundaryResult = {
  readonly kind: 'boundary';
  readonly state: PipelineState;
  readonly commands: readonly PipelineCommand[];
};

export type BaseTerminalResult = {
  readonly kind: 'terminal';
  readonly state: PipelineState;
  readonly commands: readonly PipelineCommand[];
};

export type DeferredNodeResult = {
  readonly kind: 'deferred-node';
  readonly state: PipelineState;
  readonly frameKey: Digest;
  readonly nodeId: Digest;
};

export type BaseSaturationResult = BaseBoundaryResult | BaseTerminalResult | DeferredNodeResult;

export type BaseRejectedResult = {
  readonly kind: 'rejected';
  readonly state: PipelineState;
  readonly faults: readonly [MachineFault, ...MachineFault[]];
};

export type BaseEngineResult = BaseSaturationResult | BaseRejectedResult;
