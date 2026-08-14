import { EmptyObjectSchema, type ValueSchema } from '../../src/foundation/index.js';
import type {
  ProgramActivityNode,
  ProgramMapNode,
  ProgramRegion,
} from '../../src/program/index.js';
import { kernelModule, kernelProgram } from './kernel-builders.js';
import { structuredId } from './structured-kernel-builders.js';

const end = (ordinal: number) => ({
  kind: 'end' as const,
  id: structuredId(ordinal),
  outcome: 'ok',
  output: {},
});

const bodyRegion = (outputSchema: ValueSchema, keySchema: ValueSchema): ProgramRegion => {
  const terminal = end(2_003);
  const activity: ProgramActivityNode = {
    kind: 'activity',
    id: structuredId(2_002),
    activityKind: 'script',
    requirementKey: 'indexed-map-item',
    input: {},
    inputSchema: EmptyObjectSchema,
    outputSchema,
    routes: { succeeded: terminal.id, failed: terminal.id, cancelled: terminal.id },
  };
  return {
    id: structuredId(2_001),
    inputSchema: {
      type: 'object',
      properties: { key: keySchema },
      required: ['key'],
      additionalProperties: false,
    },
    entry: activity.id,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'ok', outputSchema }],
    nodes: [activity, terminal],
  };
};

export const reverseNestedKeyMapProgram = (
  itemCount: number,
  completedOutputSchema: ValueSchema = EmptyObjectSchema,
) => {
  const values = reverseNestedKeyMapInput(itemCount).items;
  const keyAlternatives = values.map(({ identity: { key } }) => ({
    type: 'string' as const,
    enum: [key] as readonly [string],
  }));
  const [firstKey, secondKey, ...remainingKeys] = keyAlternatives;
  const keySchema: ValueSchema =
    firstKey === undefined
      ? { type: 'string' }
      : secondKey === undefined
        ? firstKey
        : { anyOf: [firstKey, secondKey, ...remainingKeys] };
  const itemsInputSchema = {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array' as const,
        items: { type: 'string' as const },
        minItems: 0,
        maxItems: 0,
      },
    },
    required: ['items'],
    additionalProperties: false as const,
  };
  const terminal = end(2_101);
  const map: ProgramMapNode = {
    kind: 'map',
    id: structuredId(2_100),
    items:
      itemCount === 0
        ? { kind: 'moduleInput', pointer: '/items' }
        : { kind: 'literal', value: values },
    itemKeyPointer: itemCount === 0 ? '' : '/identity/key',
    maximumItems: Math.max(1, itemCount),
    maximumConcurrency: 1,
    bodyInput:
      itemCount === 0 ? {} : { key: { kind: 'map', value: 'item', pointer: '/identity/key' } },
    body:
      itemCount === 0
        ? { ...bodyRegion(completedOutputSchema, keySchema), inputSchema: EmptyObjectSchema }
        : bodyRegion(completedOutputSchema, keySchema),
    bodyExits: [{ outcome: 'ok', classification: 'completed' }],
    failure: { kind: 'collect' },
    routes: { completed: terminal.id, failed: terminal.id, cancelled: terminal.id },
  };
  const region: ProgramRegion = {
    id: structuredId(2_099),
    inputSchema: itemCount === 0 ? itemsInputSchema : EmptyObjectSchema,
    entry: map.id,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'ok', outputSchema: EmptyObjectSchema }],
    nodes: [map, terminal],
  };
  return kernelProgram([kernelModule('main', region)]);
};

export const reverseNestedKeyMapInput = (itemCount: number) => ({
  items: Array.from({ length: itemCount }, (_, ordinal) => ({
    identity: { key: `item-${String(itemCount - ordinal - 1).padStart(4, '0')}` },
  })),
});
