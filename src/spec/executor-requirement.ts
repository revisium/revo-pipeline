import type { JsonValue } from './json-value.js';
import type { NodeKey } from './node-key.js';
import type { ScriptIdentity } from './script-identity.js';

export type ExecutorRequirement = {
  readonly kind: 'script';
  readonly nodeKey: NodeKey;
  readonly script: ScriptIdentity;
  readonly input: JsonValue;
};
