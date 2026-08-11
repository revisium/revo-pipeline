import canonicalize from 'canonicalize';

import { normalizePortableValue, type JsonValue, type PipelineFailure } from './portable-value.js';

export type CanonicalizedValue = {
  readonly value: JsonValue;
  readonly text: string;
  readonly bytes: Uint8Array;
};

export type CanonicalizationResult =
  | { readonly ok: true; readonly canonical: CanonicalizedValue }
  | { readonly ok: false; readonly failure: PipelineFailure };

const textEncoder = new TextEncoder();

export const canonicalizePortableValue = (input: unknown): CanonicalizationResult => {
  const portable = normalizePortableValue(input);
  if (!portable.ok) {
    return portable;
  }
  const text = canonicalize(portable.value);
  if (text === undefined) {
    return { ok: false, failure: { code: 'CANONICAL_INPUT', path: '' } };
  }
  return {
    ok: true,
    canonical: Object.freeze({
      value: portable.value,
      text,
      bytes: textEncoder.encode(text),
    }),
  };
};
