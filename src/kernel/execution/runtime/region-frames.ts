import type { Digest, JsonValue } from '../../../foundation/index.js';
import type { ProgramRegion } from '../../../program/index.js';
import type {
  MapItemMachineFrame,
  ParallelBranchMachineFrame,
  RepeatBodyMachineFrame,
} from '../../contracts/region-frames.js';
import { computeFrameKey } from '../../identity/digests.js';

const emptyResults = () => Object.freeze({});

export const createParallelBranchFrame = (
  ownerKey: Digest,
  branchKey: string,
  region: ProgramRegion,
  input: JsonValue,
): ParallelBranchMachineFrame | null => {
  const key = computeFrameKey({
    kind: 'parallelBranch',
    parentFrameKey: ownerKey,
    regionId: region.id,
    branchKey,
  });
  return key === null
    ? null
    : Object.freeze({
        kind: 'parallelBranch',
        key,
        parentFrameKey: ownerKey,
        branchKey,
        scopeInput: input,
        nodeResults: emptyResults(),
        regionId: region.id,
        status: 'active',
        ready: Object.freeze([region.entry]),
        selectedExit: null,
      });
};

export const createRepeatBodyFrame = (
  ownerKey: Digest,
  ordinal: number,
  region: ProgramRegion,
  input: JsonValue,
): RepeatBodyMachineFrame | null => {
  const key = computeFrameKey({
    kind: 'repeatBody',
    parentFrameKey: ownerKey,
    regionId: region.id,
    ordinal,
  });
  return key === null
    ? null
    : Object.freeze({
        kind: 'repeatBody',
        key,
        parentFrameKey: ownerKey,
        ordinal,
        scopeInput: input,
        nodeResults: emptyResults(),
        regionId: region.id,
        status: 'active',
        ready: Object.freeze([region.entry]),
        selectedExit: null,
      });
};

export const createMapItemFrame = (
  ownerKey: Digest,
  itemKey: string,
  region: ProgramRegion,
  input: JsonValue,
): MapItemMachineFrame | null => {
  const key = computeFrameKey({
    kind: 'mapItem',
    parentFrameKey: ownerKey,
    regionId: region.id,
    itemKey,
  });
  return key === null
    ? null
    : Object.freeze({
        kind: 'mapItem',
        key,
        parentFrameKey: ownerKey,
        itemKey,
        scopeInput: input,
        nodeResults: emptyResults(),
        regionId: region.id,
        status: 'active',
        ready: Object.freeze([region.entry]),
        selectedExit: null,
      });
};
