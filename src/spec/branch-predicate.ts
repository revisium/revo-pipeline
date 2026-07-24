import type { JsonScalar } from './json-scalar.js';

export type BranchPredicate =
  | { readonly op: 'equals'; readonly value: JsonScalar }
  | { readonly op: 'oneOf'; readonly values: readonly JsonScalar[] };
