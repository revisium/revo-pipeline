import type { NodeKey } from './node-key.js';
import type { TaskRoutes } from './task-routes.js';

export type TaskNode = {
  readonly kind: 'task';
  readonly key: NodeKey;
  readonly outcomes: TaskRoutes;
};
