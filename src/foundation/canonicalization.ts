import canonicalize from 'canonicalize';

import { normalizePortableValue, type JsonValue, type PipelineFailure } from './portable-value.js';

export type CanonicalizedValue = {
  readonly value: JsonValue;
  readonly text: string;
  readonly bytes: Uint8Array;
};

export type CanonicalizedOwnedValue = {
  readonly text: string;
  readonly bytes: Uint8Array;
};

export type CanonicalizationResult =
  | { readonly ok: true; readonly canonical: CanonicalizedValue }
  | { readonly ok: false; readonly failure: PipelineFailure };

const textEncoder = new TextEncoder();

export const canonicalizeOwnedValue = (input: unknown): CanonicalizedOwnedValue => {
  const text = canonicalize(input);
  if (text === undefined) {
    throw new TypeError('Invalid owned canonical value.');
  }
  return Object.freeze({ text, bytes: textEncoder.encode(text) });
};

export const canonicalizePortableValue = (input: unknown): CanonicalizationResult => {
  const portable = normalizePortableValue(input);
  if (!portable.ok) {
    return portable;
  }
  const { text, bytes } = canonicalizeOwnedValue(portable.value);
  return {
    ok: true,
    canonical: Object.freeze({
      value: portable.value,
      text,
      bytes,
    }),
  };
};
