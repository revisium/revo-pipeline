import { compareUnicodeCodePoints, type Digest } from '../../../foundation/index.js';
import type { PipelineCommand } from '../../contracts/commands.js';
import type { MachineFrame } from '../../contracts/frames.js';
import { cancelPendingCommand, nodeReference, pipelineReference } from '../commands.js';
import type { TransitionDraft } from './draft.js';

const nonEmptyTargets = (targets: readonly Digest[]): readonly [Digest, ...Digest[]] | null => {
  const [first, ...rest] = targets;
  return first === undefined ? null : Object.freeze([first, ...rest]);
};

const hasAncestor = (draft: TransitionDraft, frameKey: Digest, ancestorKey: Digest): boolean => {
  let current = draft.frames.get(frameKey);
  for (let depth = 0; current !== undefined && depth <= 64; depth += 1) {
    if (current.key === ancestorKey) {
      return true;
    }
    current =
      current.parentFrameKey === null ? undefined : draft.frames.get(current.parentFrameKey);
  }
  return false;
};

export const pendingAncestorKeys = (draft: TransitionDraft): ReadonlySet<Digest> => {
  const ancestors = new Set<Digest>();
  for (const operation of draft.pending.values()) {
    let current = draft.frames.get(operation.ref.frameKey);
    for (let depth = 0; current !== undefined && depth <= 64; depth += 1) {
      ancestors.add(current.key);
      current =
        current.parentFrameKey === null ? undefined : draft.frames.get(current.parentFrameKey);
    }
  }
  return ancestors;
};

export const pruneFrameTrees = (
  draft: TransitionDraft,
  ownerKeys: readonly Digest[],
  onPruned?: (frameKey: Digest) => void,
): boolean => {
  const live = pendingAncestorKeys(draft);
  if (ownerKeys.some((key) => live.has(key))) {
    return false;
  }
  const children = new Map<Digest, Digest[]>();
  for (const frame of draft.frames.values()) {
    if (frame.parentFrameKey === null) {
      continue;
    }
    const siblings = children.get(frame.parentFrameKey) ?? [];
    siblings.push(frame.key);
    children.set(frame.parentFrameKey, siblings);
  }
  const keys = new Set<Digest>(ownerKeys);
  const pending = [...ownerKeys];
  while (pending.length > 0) {
    const parent = pending.pop();
    if (parent === undefined) {
      break;
    }
    for (const child of children.get(parent) ?? []) {
      keys.add(child);
      pending.push(child);
    }
  }
  for (const key of keys) {
    onPruned?.(key);
    draft.deleteFrame(key);
  }
  return true;
};

export const pruneFrameTree = (draft: TransitionDraft, ownerKey: Digest): boolean =>
  pruneFrameTrees(draft, [ownerKey]);

export const descendantPendingTargets = (
  draft: TransitionDraft,
  ownerKey: Digest,
): readonly Digest[] =>
  Object.freeze(
    [...draft.pending.values()]
      .filter(({ ref }) => hasAncestor(draft, ref.frameKey, ownerKey))
      .map(({ commandKey }) => commandKey)
      .sort(compareUnicodeCodePoints),
  );

export const orderedCancellationOwners = (
  draft: TransitionDraft,
  frameKey: Digest,
  ownerKeys: readonly Digest[],
): readonly Digest[] | null => {
  const remaining = new Set(ownerKeys);
  const ordered: Digest[] = [];
  let current = draft.frames.get(frameKey);
  for (let depth = 0; current !== undefined && depth <= 64; depth += 1) {
    if (remaining.delete(current.key)) {
      if (current.kind !== 'parallel' && current.kind !== 'map') {
        return null;
      }
      ordered.push(current.key);
    }
    current =
      current.parentFrameKey === null ? undefined : draft.frames.get(current.parentFrameKey);
  }
  return remaining.size === 0 ? Object.freeze(ordered) : null;
};

export const requestRegionCancellation = (
  draft: TransitionDraft,
  owner: MachineFrame & { readonly nodeId: Digest },
  reasonCode: string,
): boolean => {
  if (draft.getRunCancellation() !== null || draft.regionCancellations.has(owner.key)) {
    return true;
  }
  const awaiting = descendantPendingTargets(draft, owner.key);
  const targets = nonEmptyTargets(awaiting);
  if (targets === null) {
    return true;
  }
  const ref = nodeReference(draft.programDigest, owner.key, owner.nodeId);
  const command = cancelPendingCommand(ref, targets, reasonCode);
  return draft.addRegionCancellation(
    Object.freeze({ frameKey: owner.key, reasonCode, awaiting }),
    command,
  );
};

export const requestRunCancellation = (
  draft: TransitionDraft,
  rootFrameKey: Digest,
  reasonCode: string,
): PipelineCommand | null => {
  if (draft.getRunCancellation() !== null) {
    return null;
  }
  const awaiting = Object.freeze([...draft.pending.keys()].sort(compareUnicodeCodePoints));
  draft.setRunCancellation(Object.freeze({ reasonCode, awaiting }));
  draft.setStatus('cancelling');
  draft.charge(1 + awaiting.length);
  const targets = nonEmptyTargets(awaiting);
  return targets === null
    ? null
    : cancelPendingCommand(
        pipelineReference(draft.programDigest, rootFrameKey),
        targets,
        reasonCode,
      );
};
