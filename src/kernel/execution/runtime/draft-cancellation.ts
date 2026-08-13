import { compareUnicodeCodePoints, isDigest, type Digest } from '../../../foundation/index.js';
import type { PipelineCommand } from '../../contracts/commands.js';
import type { RegionCancellation, RunCancellation } from '../../contracts/operations.js';

const RUN_CANCELLATION = '$run';

type WorkBudget = {
  readonly charge: (units?: number) => boolean;
};

export type CancellationAck = {
  readonly run: boolean;
  readonly regionOwnerKeys: readonly Digest[];
};

export type CancellationActions = {
  readonly addRegionCancellation: (
    cancellation: RegionCancellation,
    command: PipelineCommand | null,
  ) => boolean;
  readonly acknowledge: (commandKey: Digest) => CancellationAck | null;
  readonly setRunCancellation: (cancellation: RunCancellation) => void;
  readonly getRunCancellation: () => RunCancellation | null;
};

export const buildReverseCancellationIndex = (state: {
  readonly runCancellation: RunCancellation | null;
  readonly regionCancellations: readonly RegionCancellation[];
}): Map<Digest, Set<string>> => {
  const reverse = new Map<Digest, Set<string>>();
  const add = (commandKey: Digest, owner: string): void => {
    const owners = reverse.get(commandKey) ?? new Set<string>();
    owners.add(owner);
    reverse.set(commandKey, owners);
  };
  for (const key of state.runCancellation?.awaiting ?? []) {
    add(key, RUN_CANCELLATION);
  }
  for (const cancellation of state.regionCancellations) {
    for (const key of cancellation.awaiting) {
      add(key, cancellation.frameKey);
    }
  }
  return reverse;
};

const withoutKey = (values: readonly Digest[], key: Digest): readonly Digest[] =>
  Object.freeze(values.filter((value) => value !== key));

export const createCancellationActions = (
  initial: RunCancellation | null,
  regionCancellations: Map<Digest, RegionCancellation>,
  reverse: Map<Digest, Set<string>>,
  budget: WorkBudget,
  addCommand: (command: PipelineCommand) => boolean,
): CancellationActions => {
  let runCancellation = initial;
  const addReverseMembership = (key: Digest, owner: string): void => {
    const owners = reverse.get(key) ?? new Set<string>();
    owners.add(owner);
    reverse.set(key, owners);
  };
  return {
    addRegionCancellation: (cancellation, command) => {
      if (regionCancellations.has(cancellation.frameKey) || cancellation.awaiting.length === 0) {
        return false;
      }
      if (!budget.charge(1 + cancellation.awaiting.length)) {
        return false;
      }
      regionCancellations.set(cancellation.frameKey, cancellation);
      for (const key of cancellation.awaiting) {
        addReverseMembership(key, cancellation.frameKey);
      }
      return command === null || addCommand(command);
    },
    acknowledge: (commandKey) => {
      const owners = reverse.get(commandKey);
      if (owners === undefined) {
        return null;
      }
      const snapshot = Object.freeze({
        run: owners.has(RUN_CANCELLATION),
        regionOwnerKeys: Object.freeze(
          [...owners]
            .filter((owner): owner is Digest => isDigest(owner))
            .sort(compareUnicodeCodePoints),
        ),
      });
      budget.charge();
      for (const owner of owners) {
        budget.charge();
        if (owner === RUN_CANCELLATION && runCancellation !== null) {
          runCancellation = Object.freeze({
            ...runCancellation,
            awaiting: withoutKey(runCancellation.awaiting, commandKey),
          });
          continue;
        }
        const cancellation = isDigest(owner) ? regionCancellations.get(owner) : undefined;
        if (cancellation === undefined) {
          continue;
        }
        const awaiting = withoutKey(cancellation.awaiting, commandKey);
        if (awaiting.length === 0) {
          regionCancellations.delete(cancellation.frameKey);
          budget.charge();
        } else {
          regionCancellations.set(
            cancellation.frameKey,
            Object.freeze({ ...cancellation, awaiting }),
          );
        }
      }
      reverse.delete(commandKey);
      return snapshot;
    },
    setRunCancellation: (cancellation) => {
      runCancellation = cancellation;
      for (const key of cancellation.awaiting) {
        addReverseMembership(key, RUN_CANCELLATION);
      }
    },
    getRunCancellation: () => runCancellation,
  };
};
