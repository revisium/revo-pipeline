import { describe, expect, it } from 'vitest';

import { normalizeOwnedEnvelope } from '../../src/foundation/index.js';

describe('owned-envelope hostile reflection', () => {
  it('redacts every shared hostile primitive and revoked proxies', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const hostileValues = [
      revoked.proxy,
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('prototype-secret');
          },
        },
      ),
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('keys-secret');
          },
        },
      ),
      new Proxy(
        { value: true },
        {
          getOwnPropertyDescriptor() {
            throw new Error('descriptor-secret');
          },
        },
      ),
      new Proxy([true], {
        getOwnPropertyDescriptor() {
          throw new Error('array-secret');
        },
      }),
    ];

    for (const value of hostileValues) {
      const result = normalizeOwnedEnvelope(value, 16);
      expect(result).toMatchObject({ ok: false, failure: { code: 'CANONICAL_INPUT' } });
      expect(JSON.stringify(result)).not.toMatch(/secret/u);
    }
  });

  it('keeps envelope limits and own-data behavior separate from portable normalization', () => {
    const value = Object.fromEntries([['__proto__', ['safe']]]);
    const result = normalizeOwnedEnvelope(value, 1, () => 1, 3);
    if (!result.ok || typeof result.value !== 'object' || result.value === null) {
      throw new TypeError('Expected a normalized envelope.');
    }
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.hasOwn(result.value, '__proto__')).toBe(true);
    expect(Reflect.getOwnPropertyDescriptor(result.value, '__proto__')).toMatchObject({
      value: ['safe'],
    });
  });
});
