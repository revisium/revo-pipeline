import type { FactKey } from './fact-key.js';
import type { JsonScalar } from './json-scalar.js';

export type PipelineValueFact = { readonly key: FactKey; readonly value: JsonScalar };
