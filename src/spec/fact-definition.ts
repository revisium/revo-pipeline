import type { FactKey } from './fact-key.js';
import type { FactType } from './fact-type.js';

export type FactDefinition = { readonly key: FactKey; readonly type: FactType };
