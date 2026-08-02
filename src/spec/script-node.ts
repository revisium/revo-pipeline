import type { JsonValue } from './json-value.js';
import type { NodeKey } from './node-key.js';
import type { ScriptIdentity } from './script-identity.js';
import type { TaskRoutes } from './task-routes.js';

export type ScriptNode = {
  readonly kind: 'script';
  readonly key: NodeKey;
  readonly script: ScriptIdentity;
  readonly input: JsonValue;
  readonly outcomes: TaskRoutes;
};
