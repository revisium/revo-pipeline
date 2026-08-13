import {
  PIPELINE_LIMITS,
  countJsonValues,
  type Digest,
  type JsonValue,
  type PipelineFailure,
} from '../../../foundation/index.js';
import type { PipelineCommand } from '../../contracts/commands.js';
import type { MachineFrame } from '../../contracts/frames.js';
import type {
  PendingOperation,
  RegionCancellation,
  ResolvedOperation,
  RunCancellation,
} from '../../contracts/operations.js';
import type { PipelineState } from '../../contracts/state.js';
import { canonicalCommands } from '../../identity/digests.js';
import { stateFitsMachineLimits } from '../../state/bounds.js';
import { ownPipelineState } from '../../state/canonical.js';
import { buildReverseCancellationIndex, createCancellationActions } from './draft-cancellation.js';
import type { CancellationAck } from './draft-cancellation.js';
import { createMapPreflightIndex, type MapPreflightIndex } from './map-preflight-index.js';

type StateStatus = PipelineState['status'];

export type TransitionDraft = {
  readonly original: PipelineState;
  readonly programDigest: Digest;
  readonly input: JsonValue;
  readonly frames: Map<Digest, MachineFrame>;
  readonly pending: Map<Digest, PendingOperation>;
  readonly resolved: Map<Digest, ResolvedOperation>;
  readonly regionCancellations: Map<Digest, RegionCancellation>;
  readonly commands: PipelineCommand[];
  readonly mapPreflights: MapPreflightIndex;
  readonly charge: (units?: number) => boolean;
  readonly addFrame: (frame: MachineFrame) => boolean;
  readonly setFrame: (frame: MachineFrame) => void;
  readonly deleteFrame: (key: Digest) => void;
  readonly addPending: (operation: PendingOperation) => boolean;
  readonly replacePending: (operation: PendingOperation, receipt: ResolvedOperation) => boolean;
  readonly deleteReceipt: (key: Digest) => void;
  readonly addCommand: (command: PipelineCommand) => boolean;
  readonly addRegionCancellation: (
    cancellation: RegionCancellation,
    command: PipelineCommand | null,
  ) => boolean;
  readonly acknowledge: (commandKey: Digest) => CancellationAck | null;
  readonly setRunCancellation: (cancellation: RunCancellation) => void;
  readonly getRunCancellation: () => RunCancellation | null;
  readonly setStatus: (status: StateStatus) => void;
  readonly getStatus: () => StateStatus;
  readonly setResult: (result: PipelineState['result']) => void;
  readonly setFault: (fault: PipelineFailure | null) => void;
  readonly pruneReceipts: () => void;
  readonly clearExecution: () => void;
  readonly state: () => PipelineState | null;
  readonly outputCommands: () => readonly PipelineCommand[];
};

type WorkBudget = {
  readonly charge: (units?: number) => boolean;
  readonly valid: () => boolean;
};

const createWorkBudget = (
  regionCancellations: ReadonlyMap<Digest, RegionCancellation>,
  reverseCancellation: ReadonlyMap<Digest, ReadonlySet<string>>,
  hasRunCancellation: boolean,
): WorkBudget => {
  let work =
    regionCancellations.size +
    (hasRunCancellation ? 1 : 0) +
    [...reverseCancellation.values()].reduce((total, owners) => total + owners.size, 0);
  let withinBudget = work <= PIPELINE_LIMITS.machine.synchronousStepsPerTransition;
  const charge = (units = 1): boolean => {
    work += units;
    withinBudget = withinBudget && work <= PIPELINE_LIMITS.machine.synchronousStepsPerTransition;
    return withinBudget;
  };
  return Object.freeze({ charge, valid: () => withinBudget });
};

const frameActions = (frames: Map<Digest, MachineFrame>, budget: WorkBudget) => ({
  addFrame: (frame: MachineFrame): boolean => {
    if (frames.has(frame.key) || !budget.charge()) {
      return false;
    }
    frames.set(frame.key, frame);
    return true;
  },
  setFrame: (frame: MachineFrame): void => {
    frames.set(frame.key, frame);
  },
  deleteFrame: (key: Digest): void => {
    if (frames.delete(key)) {
      budget.charge();
    }
  },
});

const operationActions = (
  pending: Map<Digest, PendingOperation>,
  resolved: Map<Digest, ResolvedOperation>,
  budget: WorkBudget,
) => ({
  addPending: (operation: PendingOperation): boolean => {
    if (
      pending.has(operation.commandKey) ||
      resolved.has(operation.commandKey) ||
      !budget.charge()
    ) {
      return false;
    }
    pending.set(operation.commandKey, operation);
    return true;
  },
  replacePending: (operation: PendingOperation, receipt: ResolvedOperation): boolean => {
    if (!pending.delete(operation.commandKey) || !budget.charge()) {
      return false;
    }
    resolved.set(receipt.commandKey, receipt);
    return true;
  },
  deleteReceipt: (key: Digest): void => {
    if (resolved.delete(key)) {
      budget.charge();
    }
  },
});

const createDraftMaps = (state: PipelineState) => ({
  frames: new Map(state.frames.map((frame) => [frame.key, frame])),
  pending: new Map(state.pending.map((operation) => [operation.commandKey, operation])),
  resolved: new Map(state.resolved.map((receipt) => [receipt.commandKey, receipt])),
  regionCancellations: new Map(
    state.regionCancellations.map((cancellation) => [cancellation.frameKey, cancellation]),
  ),
});

const fitsStateEnvelope = (state: PipelineState): boolean =>
  stateFitsMachineLimits(state) &&
  countJsonValues(state, PIPELINE_LIMITS.machine.serializedStateJsonValues) <=
    PIPELINE_LIMITS.machine.serializedStateJsonValues;

export const createTransitionDraft = (state: PipelineState): TransitionDraft => {
  const { frames, pending, resolved, regionCancellations } = createDraftMaps(state);
  const reverse = buildReverseCancellationIndex(state);
  const budget = createWorkBudget(regionCancellations, reverse, state.runCancellation !== null);
  const commands: PipelineCommand[] = [];
  let status = state.status;
  let result = state.result;
  let fault = state.fault;
  const addCommand = (command: PipelineCommand): boolean => {
    if (!budget.charge()) {
      return false;
    }
    commands.push(command);
    return true;
  };
  const cancellations = createCancellationActions(
    state.runCancellation,
    regionCancellations,
    reverse,
    budget,
    addCommand,
  );
  return {
    original: state,
    programDigest: state.programDigest,
    input: state.input,
    frames,
    pending,
    resolved,
    regionCancellations,
    commands,
    mapPreflights: createMapPreflightIndex(),
    charge: budget.charge,
    ...frameActions(frames, budget),
    ...operationActions(pending, resolved, budget),
    addCommand,
    ...cancellations,
    setStatus: (next) => (status = next),
    getStatus: () => status,
    setResult: (next) => (result = next),
    setFault: (next) => (fault = next),
    pruneReceipts: () => {
      const liveFrames = new Set(frames.keys());
      for (const receipt of resolved.values()) {
        if (!liveFrames.has(receipt.ref.frameKey) && !reverse.has(receipt.commandKey)) {
          resolved.delete(receipt.commandKey);
          budget.charge();
        }
      }
    },
    clearExecution: () => {
      budget.charge(frames.size + pending.size + resolved.size + regionCancellations.size);
      frames.clear();
      pending.clear();
      resolved.clear();
      regionCancellations.clear();
      reverse.clear();
    },
    state: () => {
      if (!budget.valid()) {
        return null;
      }
      const next = ownPipelineState({
        ...state,
        status,
        frames: [...frames.values()],
        pending: [...pending.values()],
        resolved: [...resolved.values()],
        runCancellation: cancellations.getRunCancellation(),
        regionCancellations: [...regionCancellations.values()],
        result,
        fault,
      });
      return fitsStateEnvelope(next) ? next : null;
    },
    outputCommands: () => canonicalCommands(commands),
  };
};
