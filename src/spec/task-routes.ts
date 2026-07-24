import type { NodeKey } from './node-key.js';
import type { TaskOutcome } from './task-outcome.js';

export type TaskRoutes = Readonly<Record<TaskOutcome, NodeKey>>;
