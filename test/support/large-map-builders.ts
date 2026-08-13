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

const bodyRegion = (outputSchema: ValueSchema): ProgramRegion => {
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
      properties: { key: { type: 'string' } },
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
  const terminal = end(2_101);
  const map: ProgramMapNode = {
    kind: 'map',
    id: structuredId(2_100),
    items: {
      kind: 'literal',
      value: Array.from({ length: itemCount }, (_, ordinal) => ({
        identity: { key: `item-${String(itemCount - ordinal - 1).padStart(4, '0')}` },
      })),
    },
    itemKeyPointer: '/identity/key',
    maximumItems: itemCount,
    maximumConcurrency: 1,
    bodyInput: { key: { kind: 'map', value: 'item', pointer: '/identity/key' } },
    body: bodyRegion(completedOutputSchema),
    bodyExits: [{ outcome: 'ok', classification: 'completed' }],
    failure: { kind: 'collect' },
    routes: { completed: terminal.id, failed: terminal.id, cancelled: terminal.id },
  };
  const region: ProgramRegion = {
    id: structuredId(2_099),
    inputSchema: EmptyObjectSchema,
    entry: map.id,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'ok', outputSchema: EmptyObjectSchema }],
    nodes: [map, terminal],
  };
  return kernelProgram([kernelModule('main', region)]);
};
