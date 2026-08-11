import { createHash } from 'node:crypto';

import { canonicalizePortableValue } from './canonicalization.js';
import { type PipelineFailure } from './portable-value.js';

export const DIGEST_DOMAINS = Object.freeze([
  'pipeline-source/v1',
  'pipeline-materialization/v1',
  'pipeline-program/v1',
  'pipeline-ir-id/v1',
  'pipeline-frame-key/v1',
  'pipeline-command-key/v1',
  'pipeline-event/v1',
] as const);

export type DigestDomain = (typeof DIGEST_DOMAINS)[number];
export type Digest = `sha256:${string}`;
const digestDomainValues: readonly string[] = DIGEST_DOMAINS;

export type DigestResult =
  | { readonly ok: true; readonly digest: Digest }
  | { readonly ok: false; readonly failure: PipelineFailure };

const isDigestDomain = (value: unknown): value is DigestDomain =>
  typeof value === 'string' && digestDomainValues.includes(value);

const assertDigestDomain: (value: unknown) => asserts value is DigestDomain = (value) => {
  if (!isDigestDomain(value)) {
    throw new TypeError('Invalid pipeline digest domain.');
  }
};

const digestPrefix = (domain: DigestDomain, payloadLength: number): string => {
  assertDigestDomain(domain);
  return `revo-pipeline-digest-v1\n${domain}\n${payloadLength}\n`;
};

export const digestCanonicalBytes = (domain: DigestDomain, payload: Uint8Array): Digest => {
  const hexadecimal = createHash('sha256')
    .update(digestPrefix(domain, payload.byteLength), 'utf8')
    .update(payload)
    .digest('hex');
  return `sha256:${hexadecimal}`;
};

export const computeDomainDigest = (domain: DigestDomain, input: unknown): DigestResult => {
  assertDigestDomain(domain);
  const canonical = canonicalizePortableValue(input);
  return canonical.ok
    ? { ok: true, digest: digestCanonicalBytes(domain, canonical.canonical.bytes) }
    : canonical;
};

export const isDigest = (value: unknown): value is Digest =>
  typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
