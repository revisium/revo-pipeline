import { describe, expect, it } from 'vitest';

import {
  DIGEST_DOMAINS,
  computeDomainDigest,
  digestCanonicalBytes,
  isDigest,
  type DigestDomain,
} from '../../src/foundation/index.js';

const digest = (domain: DigestDomain, value: unknown) => {
  const result = computeDomainDigest(domain, value);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error('Expected digest success.');
  }
  return result.digest;
};

describe('domain-separated SHA-256', () => {
  it('pins the exact seven domains', () => {
    expect(DIGEST_DOMAINS).toEqual([
      'pipeline-source/v1',
      'pipeline-materialization/v1',
      'pipeline-program/v1',
      'pipeline-ir-id/v1',
      'pipeline-frame-key/v1',
      'pipeline-command-key/v1',
      'pipeline-event/v1',
    ]);
  });

  it('matches the normative synthesized direct IR ID vector', () => {
    expect(
      digest('pipeline-ir-id/v1', {
        loweringRole: 'direct',
        ordinal: 0,
        sourcePath: '/modules/0/region/nodes/0',
      }),
    ).toBe('sha256:0850c1cd1ae717ed79e795935ed929b426fbae40e5a81b64604b7d0a92467761');
  });

  it.each([
    [
      'consensusParallel',
      0,
      'sha256:b7398c2a4268cee28f7cb358b4acc06b79f0a5c1a8f07c8a3d92897b42117bf7',
    ],
    [
      'consensusParticipantRegion',
      0,
      'sha256:91e07101b490bc0987f52616d63ccf0a289bae4318f7fdb211d3e95f60c30c1c',
    ],
    [
      'consensusParticipantActivity',
      0,
      'sha256:bdede9d2cc0316cc0babe56bf55853fd3981145f98e6c4bb9f78b64ec998bae2',
    ],
    [
      'consensusParticipantExit',
      0,
      'sha256:4b1d2754eac24b6ef19c2c04cba7a7b67a9f465eeed370a3cefe88a18051d6ed',
    ],
    [
      'consensusParticipantExit',
      1,
      'sha256:53a38e0505c702478d3031cc7318c17f0f9c6193e74158ce07ad5ed17d0e6379',
    ],
    [
      'consensusParticipantExit',
      2,
      'sha256:6a551a1ac0ba9513ef10235e8aba6b81ee9a0735b1cecaaeced3eee225897718',
    ],
    [
      'consensusChoice',
      0,
      'sha256:6519dffd7a4ec877bd5193c52b3668a67542c497627a1e42c4c77605fd8fd633',
    ],
  ] as const)('matches the normative %s/%i IR ID vector', (loweringRole, ordinal, expected) => {
    expect(
      digest('pipeline-ir-id/v1', {
        loweringRole,
        ordinal,
        sourcePath: '/modules/0/region/nodes/0',
      }),
    ).toBe(expected);
  });

  it('matches the normative root frame and command key vectors', () => {
    const frameKey = digest('pipeline-frame-key/v1', {
      kind: 'rootRegion',
      parentFrameKey: null,
      regionId: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    });
    expect(frameKey).toBe(
      'sha256:2c6bc1ea876c7f591aa19f1477e1f9da47e22a0cf83b567f6bc5b9568774f61b',
    );
    expect(
      digest('pipeline-command-key/v1', {
        kind: 'dispatchActivity',
        ref: {
          frameKey,
          nodeId: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
          programDigest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        },
      }),
    ).toBe('sha256:843e4452009d1a2c365449a902a44f846ad0b3ea54271db4fff2ba7e79987aae');
  });

  it('separates every domain and uses the byte length in the preimage', () => {
    const digests = DIGEST_DOMAINS.map((domain) => digest(domain, { value: 'é' }));
    expect(new Set(digests).size).toBe(DIGEST_DOMAINS.length);

    const utf8Payload = new TextEncoder().encode('"é"');
    expect(utf8Payload.byteLength).toBe(4);
    expect(digestCanonicalBytes('pipeline-event/v1', utf8Payload)).toBe(
      digest('pipeline-event/v1', 'é'),
    );
  });

  it('rejects non-portable input and recognizes only full lowercase digests', () => {
    expect(computeDomainDigest('pipeline-source/v1', 'e\u0301')).toEqual({
      ok: false,
      failure: { code: 'CANONICAL_INPUT', path: '' },
    });
    const valid = digest('pipeline-source/v1', null);
    expect(isDigest(valid)).toBe(true);
    expect(isDigest(valid.toUpperCase())).toBe(false);
    expect(isDigest(`sha256:${'0'.repeat(63)}`)).toBe(false);
  });

  it('rejects domains outside the exact seven at both digest entry points', () => {
    for (const domain of ['pipeline-plan/v1', 'pipeline-source/v2', '', {}, null]) {
      expect(() => {
        Reflect.apply(digestCanonicalBytes, undefined, [domain, new Uint8Array()]);
      }).toThrow('Invalid pipeline digest domain.');
      expect(() => {
        Reflect.apply(computeDomainDigest, undefined, [domain, null]);
      }).toThrow('Invalid pipeline digest domain.');
    }
  });
});
