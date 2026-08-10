import { Type, type Static } from 'typebox';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { closedObject } from '../../src/foundation/index.js';

describe('closed TypeBox schema helper', () => {
  it('always emits additionalProperties false with only the three metadata options', () => {
    const schema = closedObject(
      {
        key: Type.String(),
        count: Type.Optional(Type.Integer()),
      },
      { $id: 'fixture', title: 'Fixture', description: 'A closed fixture.' },
    );

    expect(schema).toMatchObject({
      type: 'object',
      $id: 'fixture',
      title: 'Fixture',
      description: 'A closed fixture.',
      properties: { key: { type: 'string' }, count: { type: 'integer' } },
      required: ['key'],
      additionalProperties: false,
    });
    type Fixture = Static<typeof schema>;
    expectTypeOf<Fixture['key']>().toEqualTypeOf<string>();
    expectTypeOf<Fixture['count']>().toEqualTypeOf<number | undefined>();
  });

  it('accepts no options and still closes the object', () => {
    expect(closedObject({})).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });

  it.each([{ additionalProperties: true }, { minProperties: 1 }, { required: [] }, { title: 1 }])(
    'rejects the unlisted or structurally invalid options %#',
    (options) => {
      expect(() => {
        Reflect.apply(closedObject, undefined, [{}, options]);
      }).toThrow('Invalid closed object schema options.');
    },
  );

  it('rejects accessors and hostile proxies without invoking or exposing them', () => {
    let getterCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, 'title', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'schema-secret';
      },
    });
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('proxy-secret');
        },
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    for (const options of [accessor, hostile, revoked.proxy]) {
      expect(() => {
        Reflect.apply(closedObject, undefined, [{}, options]);
      }).toThrow('Invalid closed object schema options.');
    }
    expect(getterCalls).toBe(0);
  });
});
