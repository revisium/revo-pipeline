import type { ProgramNodeId } from '../../program/index.js';

export const targetId = (
  nodeKey: string,
  targetIds: ReadonlyMap<string, ProgramNodeId>,
): ProgramNodeId => {
  const id = targetIds.get(nodeKey);
  if (id === undefined) {
    throw new TypeError('Expected a validated local route target.');
  }
  return id;
};

export const activityTargetRoutes = (
  routes: { readonly succeeded: string; readonly failed: string; readonly cancelled: string },
  targetIds: ReadonlyMap<string, ProgramNodeId>,
): {
  readonly succeeded: ProgramNodeId;
  readonly failed: ProgramNodeId;
  readonly cancelled: ProgramNodeId;
} =>
  Object.freeze({
    succeeded: targetId(routes.succeeded, targetIds),
    failed: targetId(routes.failed, targetIds),
    cancelled: targetId(routes.cancelled, targetIds),
  });

export const waitTargetRoutes = (
  routes: { readonly completed: string; readonly cancelled: string },
  targetIds: ReadonlyMap<string, ProgramNodeId>,
): { readonly completed: ProgramNodeId; readonly cancelled: ProgramNodeId } =>
  Object.freeze({
    completed: targetId(routes.completed, targetIds),
    cancelled: targetId(routes.cancelled, targetIds),
  });

export const repeatTargetRoutes = (
  routes: {
    readonly completed: string;
    readonly exhausted: string;
    readonly failed: string;
    readonly cancelled: string;
  },
  targetIds: ReadonlyMap<string, ProgramNodeId>,
): {
  readonly completed: ProgramNodeId;
  readonly exhausted: ProgramNodeId;
  readonly failed: ProgramNodeId;
  readonly cancelled: ProgramNodeId;
} =>
  Object.freeze({
    completed: targetId(routes.completed, targetIds),
    exhausted: targetId(routes.exhausted, targetIds),
    failed: targetId(routes.failed, targetIds),
    cancelled: targetId(routes.cancelled, targetIds),
  });

export const mapTargetRoutes = (
  routes: { readonly completed: string; readonly failed: string; readonly cancelled: string },
  targetIds: ReadonlyMap<string, ProgramNodeId>,
): {
  readonly completed: ProgramNodeId;
  readonly failed: ProgramNodeId;
  readonly cancelled: ProgramNodeId;
} =>
  Object.freeze({
    completed: targetId(routes.completed, targetIds),
    failed: targetId(routes.failed, targetIds),
    cancelled: targetId(routes.cancelled, targetIds),
  });
