import type {
  PipelineProgram,
  ProgramNode,
  ProgramNodeId,
  ProgramRegion,
} from '../../src/program/index.js';
import { emptySchema } from './source-builders.js';

export const programId = (digit = '1'): ProgramNodeId => `sha256:${digit.repeat(64)}`;

export const programEnd = (
  id = programId('9'),
): Extract<ProgramNode, { readonly kind: 'end' }> => ({
  kind: 'end',
  id,
  outcome: 'ok',
  output: {},
});

export const programRegion = (
  nodes: readonly [ProgramNode, ...ProgramNode[]] = [programEnd()],
  id = programId('8'),
): ProgramRegion => ({
  id,
  inputSchema: emptySchema(),
  entry: nodes[0].id,
  outputSchema: emptySchema(),
  exits: [{ outcome: 'ok', outputSchema: emptySchema() }],
  nodes,
});

const routes = {
  succeeded: programId('9'),
  failed: programId('9'),
  cancelled: programId('9'),
};

export const programNodeExamples = (): readonly ProgramNode[] => [
  {
    kind: 'activity',
    id: programId('1'),
    activityKind: 'agent',
    requirementKey: 'agent-binding',
    input: {},
    inputSchema: emptySchema(),
    outputSchema: emptySchema(),
    routes,
  },
  {
    kind: 'choice',
    id: programId('2'),
    selector: { kind: 'literal', value: true },
    cases: [{ key: 'yes', when: { kind: 'equals', value: true }, target: programId('9') }],
    otherwise: programId('9'),
  },
  {
    kind: 'call',
    id: programId('3'),
    module: 'child',
    input: {},
    outputSchema: emptySchema(),
    routes: {
      outcomes: [{ outcome: 'ok', target: programId('9') }],
      failed: programId('9'),
      cancelled: programId('9'),
    },
  },
  {
    kind: 'parallel',
    id: programId('4'),
    mode: 'generic',
    branches: [
      {
        key: 'left',
        input: {},
        region: programRegion(),
        exits: [{ outcome: 'ok', classification: 'qualifies' }],
      },
      {
        key: 'right',
        input: {},
        region: programRegion(undefined, programId('7')),
        exits: [{ outcome: 'ok', classification: 'qualifies' }],
      },
    ],
    policy: { kind: 'all' },
    remaining: 'drain',
    next: programId('9'),
  },
  {
    kind: 'repeat',
    id: programId('5'),
    maximumIterations: 2,
    initialInput: {},
    nextInput: {},
    body: programRegion(),
    bodyExits: [{ outcome: 'ok', classification: 'value' }],
    continueWhen: { kind: 'exists', selector: { kind: 'repeat', value: 'iteration', pointer: '' } },
    output: {},
    outputSchema: emptySchema(),
    routes: {
      completed: programId('9'),
      exhausted: programId('9'),
      failed: programId('9'),
      cancelled: programId('9'),
    },
  },
  {
    kind: 'map',
    id: programId('6'),
    items: { kind: 'literal', value: [] },
    itemKeyPointer: '',
    maximumItems: 2,
    maximumConcurrency: 1,
    bodyInput: {},
    body: programRegion(),
    bodyExits: [{ outcome: 'ok', classification: 'completed' }],
    failure: { kind: 'collect' },
    routes: {
      completed: programId('9'),
      failed: programId('9'),
      cancelled: programId('9'),
    },
  },
  {
    kind: 'wait',
    id: programId('7'),
    wait: { kind: 'duration', durationMs: 1 },
    routes: { completed: programId('9'), cancelled: programId('9') },
  },
  {
    kind: 'humanGate',
    id: programId('8'),
    subject: 'Approve?',
    answers: ['yes'],
    authorizationRequirements: [],
    routes: {
      answers: [{ answer: 'yes', target: programId('9') }],
      conflict: programId('9'),
      deadline: programId('9'),
      cancelled: programId('9'),
    },
  },
  programEnd(),
];

export const pipelineProgram = (): PipelineProgram => ({
  schemaVersion: 'pipeline-program/v1',
  key: 'pipeline',
  sourceDigest: programId('a'),
  materializationDigest: programId('b'),
  entryModule: 'main',
  maximumTotalActivities: 16,
  modules: [
    {
      key: 'main',
      inputSchema: emptySchema(),
      outputSchema: emptySchema(),
      region: programRegion(),
    },
  ],
});
