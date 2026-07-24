import type { NodeKey } from './node-key.js';
import type { ResolutionName } from './resolution-name.js';

export type GateResolution = { readonly nodeKey: NodeKey; readonly resolution: ResolutionName };
