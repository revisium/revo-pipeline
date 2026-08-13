import { EmptyObjectSchema } from '../../src/foundation/index.js';
import type {
  ProgramActivityNode,
  ProgramNode,
  ProgramParallelBranch,
  ProgramParallelNode,
  ProgramRegion,
} from '../../src/program/index.js';
import { kernelModule, kernelProgram } from './kernel-builders.js';
import { structuredId } from './structured-kernel-builders.js';

export type CancellationScope = 'callRegion' | 'mapItem' | 'parallelBranch' | 'repeatBody';

const end = (ordinal: number) => ({
  kind: 'end' as const,
  id: structuredId(ordinal),
  outcome: 'done',
  output: {},
});

const operationRegion = (base: number, cancellationTrap: boolean): ProgramRegion => {
  const terminal = end(base + 3);
  const trap: ProgramActivityNode = {
    kind: 'activity',
    id: structuredId(base + 2),
    activityKind: 'script',
    requirementKey: 'forbidden-cancelled-route',
    input: {},
    inputSchema: EmptyObjectSchema,
    outputSchema: EmptyObjectSchema,
    routes: { succeeded: terminal.id, failed: terminal.id, cancelled: terminal.id },
  };
  const activity: ProgramActivityNode = {
    ...trap,
    id: structuredId(base + 1),
    requirementKey: `operation-${base}`,
    routes: {
      succeeded: cancellationTrap ? trap.id : terminal.id,
      failed: cancellationTrap ? trap.id : terminal.id,
      cancelled: cancellationTrap ? trap.id : terminal.id,
    },
  };
  return {
    id: structuredId(base),
    inputSchema: EmptyObjectSchema,
    entry: activity.id,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'done', outputSchema: EmptyObjectSchema }],
    nodes: cancellationTrap ? [activity, trap, terminal] : [activity, terminal],
  };
};

const wrapperRegion = (scope: CancellationScope, child: ProgramRegion): ProgramRegion => {
  const terminal = end(720);
  let owner: ProgramNode;
  if (scope === 'callRegion') {
    owner = {
      kind: 'call',
      id: structuredId(710),
      module: 'child',
      input: {},
      outputSchema: EmptyObjectSchema,
      routes: {
        outcomes: [{ outcome: 'done', target: terminal.id }],
        failed: terminal.id,
        cancelled: terminal.id,
      },
    };
  } else if (scope === 'repeatBody') {
    owner = {
      kind: 'repeat',
      id: structuredId(711),
      maximumIterations: 1,
      initialInput: {},
      nextInput: {},
      body: child,
      bodyExits: [{ outcome: 'done', classification: 'value' }],
      continueWhen: { kind: 'equals', selector: { kind: 'literal', value: false }, value: true },
      output: {},
      outputSchema: EmptyObjectSchema,
      routes: {
        completed: terminal.id,
        exhausted: terminal.id,
        failed: terminal.id,
        cancelled: terminal.id,
      },
    };
  } else if (scope === 'mapItem') {
    owner = {
      kind: 'map',
      id: structuredId(712),
      items: { kind: 'literal', value: ['only'] },
      itemKeyPointer: '',
      maximumItems: 1,
      maximumConcurrency: 1,
      bodyInput: {},
      body: child,
      bodyExits: [{ outcome: 'done', classification: 'completed' }],
      failure: { kind: 'collect' },
      routes: { completed: terminal.id, failed: terminal.id, cancelled: terminal.id },
    };
  } else {
    const idle = {
      id: structuredId(730),
      inputSchema: EmptyObjectSchema,
      entry: structuredId(731),
      outputSchema: EmptyObjectSchema,
      exits: [{ outcome: 'done', outputSchema: EmptyObjectSchema }],
      nodes: [end(731)],
    } satisfies ProgramRegion;
    owner = {
      kind: 'parallel',
      id: structuredId(713),
      mode: 'generic',
      branches: [
        {
          key: 'active',
          input: {},
          region: child,
          exits: [{ outcome: 'done', classification: 'qualifies' }],
        },
        {
          key: 'idle',
          input: {},
          region: idle,
          exits: [{ outcome: 'done', classification: 'qualifies' }],
        },
      ],
      policy: { kind: 'all' },
      remaining: 'drain',
      next: terminal.id,
    };
  }
  return {
    id: structuredId(700),
    inputSchema: EmptyObjectSchema,
    entry: owner.id,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'done', outputSchema: EmptyObjectSchema }],
    nodes: [owner, terminal],
  };
};

export const nestedCancellationProgram = (scope: CancellationScope) => {
  const left = operationRegion(600, false);
  const child = operationRegion(800, true);
  const right = wrapperRegion(scope, child);
  const branches: [ProgramParallelBranch, ProgramParallelBranch] = [
    {
      key: 'left',
      input: {},
      region: left,
      exits: [{ outcome: 'done', classification: 'qualifies' }],
    },
    {
      key: 'right',
      input: {},
      region: right,
      exits: [{ outcome: 'done', classification: 'qualifies' }],
    },
  ];
  const terminal = end(902);
  const parallel: ProgramParallelNode = {
    kind: 'parallel',
    id: structuredId(901),
    mode: 'generic',
    branches,
    policy: { kind: 'any' },
    remaining: 'cancel',
    next: terminal.id,
  };
  const main: ProgramRegion = {
    id: structuredId(900),
    inputSchema: EmptyObjectSchema,
    entry: parallel.id,
    outputSchema: EmptyObjectSchema,
    exits: [{ outcome: 'done', outputSchema: EmptyObjectSchema }],
    nodes: [parallel, terminal],
  };
  const modules = [kernelModule('main', main)];
  if (scope === 'callRegion') {
    modules.push(kernelModule('child', child));
  }
  const [first, ...rest] = modules;
  if (first === undefined) {
    throw new TypeError('Expected nested cancellation modules.');
  }
  return kernelProgram([first, ...rest], 'main');
};
