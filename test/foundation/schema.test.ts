import { Type, type Static } from 'typebox';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { closedObject } from '../../src/foundation/index.js';

describe('closed TypeBox schema helper', () => {
  it('always emits additionalProperties false while preserving property inference', () => {
    const schema = closedObject({
      key: Type.String(),
      count: Type.Optional(Type.Integer()),
    });

    expect(schema).toMatchObject({
      type: 'object',
      properties: { key: { type: 'string' }, count: { type: 'integer' } },
      required: ['key'],
      additionalProperties: false,
    });
    type Fixture = Static<typeof schema>;
    expectTypeOf<Fixture['key']>().toEqualTypeOf<string>();
    expectTypeOf<Fixture['count']>().toEqualTypeOf<number | undefined>();
  });
});
