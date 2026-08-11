import { describe, expect, it } from 'vitest';

import {
  appendJsonPointer,
  isDisplayString,
  isIdentifier,
  isJsonPointer,
  parseJsonPointer,
  readJsonPointer,
  unescapeJsonPointerToken,
} from '../../src/foundation/index.js';

describe('identifiers and display strings', () => {
  it.each(['agent', 'é', '🧭', 'a'.repeat(64)])('accepts the identifier %j', (value) => {
    expect(isIdentifier(value)).toBe(true);
  });

  it.each(['', 'a'.repeat(65), 'e\u0301', '\ud800', 'a/b', 'a~b', 'a\u0000b'])(
    'rejects the identifier %j',
    (value) => {
      expect(isIdentifier(value)).toBe(false);
    },
  );

  it('bounds display strings by Unicode code point rather than UTF-16 length', () => {
    expect(isDisplayString('🧭'.repeat(512))).toBe(true);
    expect(isDisplayString('🧭'.repeat(513))).toBe(false);
    expect(isDisplayString('e\u0301')).toBe(false);
  });
});

describe('RFC 6901 JSON pointers', () => {
  it.each(['', '/', '/a', '/a~1b', '/m~0n', '/é/🧭'])('accepts %j', (value) => {
    expect(isJsonPointer(value)).toBe(true);
  });

  it.each(['a', '/~', '/~2', '/e\u0301', '/\ud800'])('rejects %j', (value) => {
    expect(isJsonPointer(value)).toBe(false);
  });

  it('escapes, appends, and parses tokens exactly', () => {
    expect(appendJsonPointer('/items', 'a/b~c')).toBe('/items/a~1b~0c');
    expect(parseJsonPointer('/items/a~1b~0c')).toEqual(['items', 'a/b~c']);
    expect(unescapeJsonPointerToken('~0~1')).toBe('~/');
    expect(unescapeJsonPointerToken('~2')).toBeNull();
  });

  it('uses own properties and canonical array indices during traversal', () => {
    const inherited = { inherited: 'not-visible' };
    const value = {
      items: [{ key: 'value' }],
      '': 'empty-token',
    };
    Reflect.setPrototypeOf(value, inherited);

    expect(readJsonPointer(value, '/items/0/key')).toEqual({ found: true, value: 'value' });
    expect(readJsonPointer(value, '/items/01/key')).toEqual({ found: false });
    expect(readJsonPointer(value, '/inherited')).toEqual({ found: false });
    expect(readJsonPointer(value, '/')).toEqual({ found: true, value: 'empty-token' });
  });

  it('treats sparse and accessor properties as missing without invoking a getter', () => {
    let getterCalls = 0;
    const value: { readonly items: unknown[]; readonly secret?: string } = { items: [] };
    value.items.length = 1;
    Object.defineProperty(value, 'secret', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'secret';
      },
    });

    expect(readJsonPointer(value, '/items/0')).toEqual({ found: false });
    expect(readJsonPointer(value, '/secret')).toEqual({ found: false });
    expect(getterCalls).toBe(0);
  });

  it('is total and redacted for revoked and hostile reflective containers', () => {
    const revokedRoot = Proxy.revocable({}, {});
    const revokedNested = Proxy.revocable({}, {});
    revokedRoot.revoke();
    revokedNested.revoke();

    expect(readJsonPointer(revokedRoot.proxy, '')).toEqual({ found: false });
    expect(readJsonPointer({ nested: revokedNested.proxy }, '/nested')).toEqual({ found: false });

    for (const trap of ['getPrototypeOf', 'getOwnPropertyDescriptor', 'ownKeys'] as const) {
      const hostile = new Proxy(
        { value: 'secret' },
        {
          [trap]() {
            throw new Error('secret');
          },
        },
      );
      expect(readJsonPointer(hostile, '/value')).toEqual({ found: false });
    }
  });

  it('reads descriptors without invoking proxy get traps or accessors', () => {
    let getCalls = 0;
    let getterCalls = 0;
    const target = { visible: 'value' };
    Object.defineProperty(target, 'hidden', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('secret');
      },
    });
    const hostile = new Proxy(target, {
      get() {
        getCalls += 1;
        throw new Error('secret');
      },
    });

    expect(readJsonPointer(hostile, '/visible')).toEqual({ found: true, value: 'value' });
    expect(readJsonPointer(hostile, '/hidden')).toEqual({ found: false });
    expect(getCalls).toBe(0);
    expect(getterCalls).toBe(0);
  });

  it('treats malformed array reflection as missing', () => {
    const malformed = new Proxy([], {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'length') {
          throw new Error('secret');
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expect(readJsonPointer(malformed, '/0')).toEqual({ found: false });
  });
});
