import type { JsonPointer } from './json-pointer.js';

export type JsonScalar = null | boolean | number | string;
export type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type PipelineFailure = {
  readonly code: string;
  readonly path: JsonPointer;
};
