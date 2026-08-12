import type { Digest, JsonValue } from '../../foundation/index.js';
import type { ProgramCallNode, ProgramRegion } from '../../program/index.js';
import type { CallRegionMachineFrame, RootRegionMachineFrame } from '../contracts/region-frames.js';
import type { CallMachineFrame } from '../contracts/structured-frames.js';
import { computeFrameKey } from '../identity/digests.js';

const emptyNodeResults = () => Object.freeze({});

export const createRootFrame = (
  region: ProgramRegion,
  input: JsonValue,
): RootRegionMachineFrame | null => {
  const key = computeFrameKey({ kind: 'rootRegion', parentFrameKey: null, regionId: region.id });
  return key === null
    ? null
    : Object.freeze({
        kind: 'rootRegion',
        key,
        parentFrameKey: null,
        scopeInput: input,
        nodeResults: emptyNodeResults(),
        regionId: region.id,
        status: 'active',
        ready: Object.freeze([region.entry]),
        selectedExit: null,
      });
};

export type CallFrames = {
  readonly owner: CallMachineFrame;
  readonly region: CallRegionMachineFrame;
};

export const createCallFrames = (
  parentFrameKey: Digest,
  node: ProgramCallNode,
  childRegion: ProgramRegion,
  input: JsonValue,
): CallFrames | null => {
  const ownerKey = computeFrameKey({ kind: 'call', parentFrameKey, nodeId: node.id });
  if (ownerKey === null) {
    return null;
  }
  const childKey = computeFrameKey({
    kind: 'callRegion',
    parentFrameKey: ownerKey,
    regionId: childRegion.id,
  });
  if (childKey === null) {
    return null;
  }
  return Object.freeze({
    owner: Object.freeze({
      kind: 'call',
      key: ownerKey,
      parentFrameKey,
      scopeInput: input,
      nodeResults: emptyNodeResults(),
      nodeId: node.id,
      childRegionKey: childKey,
      childResult: null,
      status: 'active',
    }),
    region: Object.freeze({
      kind: 'callRegion',
      key: childKey,
      parentFrameKey: ownerKey,
      scopeInput: input,
      nodeResults: emptyNodeResults(),
      regionId: childRegion.id,
      status: 'active',
      ready: Object.freeze([childRegion.entry]),
      selectedExit: null,
    }),
  });
};
