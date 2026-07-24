import type { NodeKey } from './node-key.js';
import type { ResolutionName } from './resolution-name.js';

export type HumanGateRoute = { readonly resolution: ResolutionName; readonly to: NodeKey };
