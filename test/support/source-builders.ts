import type {
  PipelineSourcePackage,
  SourceNode,
  SourceRegion,
  ValueSchema,
} from '../../src/source/index.js';
import { AgentActivityInputValueSchema } from '../../src/source/index.js';

type NodeKind = SourceNode['kind'];
type NodeOf<Kind extends NodeKind> = Extract<SourceNode, { readonly kind: Kind }>;
type NodeBuilders = {
  readonly [Kind in NodeKind]: (target?: string) => NodeOf<Kind>;
};

export const emptySchema = (): ValueSchema => ({
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
});

export const endNode = (key = 'done', outcome = 'ok'): NodeOf<'end'> => ({
  kind: 'end',
  id: key,
  outcome,
  output: {},
});

export const childRegion = (
  key = 'child',
  outcome = 'ok',
  outputSchema: ValueSchema = emptySchema(),
): SourceRegion => ({
  key,
  inputSchema: emptySchema(),
  entry: `${key}-done`,
  outputSchema,
  exits: [{ outcome, outputSchema }],
  nodes: [endNode(`${key}-done`, outcome)],
});

const activityRoutes = (target: string) => ({
  succeeded: target,
  failed: target,
  cancelled: target,
});

const consensusRoutes = (target: string) => ({
  approved: target,
  rejected: target,
  inconclusive: target,
  participantFailed: target,
  cancelled: target,
});

export const sourceNodeBuilders = {
  agent: (target = 'done') => ({
    kind: 'agent',
    id: 'activity',
    strategies: [{ kind: 'single', routes: activityRoutes(target) }],
    input: { prompt: { kind: 'scopeInput', pointer: '/prompt' } },
    inputSchema: AgentActivityInputValueSchema,
    outputSchema: emptySchema(),
  }),
  script: (target = 'done') => ({
    kind: 'script',
    id: 'activity',
    requirementKey: 'prepare',
    script: { id: 'script:prepare-script', version: 1 },
    input: {},
    inputSchema: emptySchema(),
    outputSchema: emptySchema(),
    routes: activityRoutes(target),
  }),
  choice: (target = 'done') => ({
    kind: 'choice',
    id: 'activity',
    selector: { kind: 'literal', value: true },
    cases: [{ key: 'yes', when: { kind: 'equals', value: true }, target }],
    otherwise: target,
  }),
  parallel: (target = 'done') => ({
    kind: 'parallel',
    id: 'activity',
    branches: [
      {
        key: 'left',
        input: {},
        region: childRegion('left-region'),
        exits: [{ outcome: 'ok', classification: 'qualifies' }],
      },
      {
        key: 'right',
        input: {},
        region: childRegion('right-region'),
        exits: [{ outcome: 'ok', classification: 'qualifies' }],
      },
    ],
    policy: { kind: 'all' },
    remaining: 'drain',
    routes: {
      completed: target,
      impossible: target,
      failed: target,
      cancelled: target,
    },
  }),
  repeat: (target = 'done') => ({
    kind: 'repeat',
    id: 'activity',
    maximumIterations: 2,
    initialInput: {},
    nextInput: {},
    body: childRegion('repeat-body', 'value'),
    bodyExits: [{ outcome: 'value', classification: 'value' }],
    continueWhen: { kind: 'exists', selector: { kind: 'repeat', value: 'iteration', pointer: '' } },
    output: {},
    outputSchema: emptySchema(),
    routes: {
      completed: target,
      exhausted: target,
      failed: target,
      cancelled: target,
    },
  }),
  map: (target = 'done') => ({
    kind: 'map',
    id: 'activity',
    items: { kind: 'literal', value: [] },
    itemKeyPointer: '',
    maximumItems: 2,
    maximumConcurrency: 1,
    bodyInput: {},
    body: childRegion('map-body', 'completed'),
    bodyExits: [{ outcome: 'completed', classification: 'completed' }],
    failure: { kind: 'collect' },
    routes: { completed: target, failed: target, cancelled: target },
  }),
  wait: (target = 'done') => ({
    kind: 'wait',
    id: 'activity',
    wait: { kind: 'duration', durationMs: 1 },
    routes: { completed: target, cancelled: target },
  }),
  humanGate: (target = 'done') => ({
    kind: 'humanGate',
    id: 'activity',
    subject: 'Approve?',
    answers: ['yes'],
    authorizationRequirements: [],
    payloadSchema: null,
    deadline: null,
    routes: {
      answers: [{ answer: 'yes', target }],
      cancelled: target,
    },
  }),
  consensus: (target = 'done') => ({
    kind: 'consensus',
    id: 'activity',
    participants: [
      {
        key: 'left',
        bindingKey: 'left-binding',
        input: { prompt: { kind: 'scopeInput', pointer: '/prompt' } },
        inputSchema: AgentActivityInputValueSchema,
      },
      {
        key: 'right',
        bindingKey: 'right-binding',
        input: { prompt: { kind: 'scopeInput', pointer: '/prompt' } },
        inputSchema: AgentActivityInputValueSchema,
      },
    ],
    policy: { kind: 'unanimous' },
    remaining: 'drain',
    routes: consensusRoutes(target),
  }),
  call: (target = 'done') => ({
    kind: 'call',
    id: 'activity',
    module: 'child-module',
    input: {},
    outputSchema: emptySchema(),
    routes: {
      outcomes: [{ outcome: 'ok', target }],
      failed: target,
      cancelled: target,
    },
  }),
  end: () => endNode('activity'),
} satisfies NodeBuilders;

export const allSourceNodeExamples = (target = 'done'): readonly SourceNode[] => [
  sourceNodeBuilders.agent(target),
  sourceNodeBuilders.script(target),
  sourceNodeBuilders.choice(target),
  sourceNodeBuilders.parallel(target),
  sourceNodeBuilders.repeat(target),
  sourceNodeBuilders.map(target),
  sourceNodeBuilders.wait(target),
  sourceNodeBuilders.humanGate(target),
  sourceNodeBuilders.consensus(target),
  sourceNodeBuilders.call(target),
  sourceNodeBuilders.end(),
];

export const sourceWithNodes = (
  nodes: readonly [SourceNode, ...SourceNode[]],
  entry = nodes[0].id,
): PipelineSourcePackage => {
  const inputSchema: ValueSchema = nodes.some(
    (node) => node.kind === 'agent' || node.kind === 'consensus',
  )
    ? {
        type: 'object',
        properties: { prompt: { type: 'string' } },
        required: ['prompt'],
        additionalProperties: false,
      }
    : emptySchema();
  return {
    schemaVersion: 'pipeline-source/v1',
    key: 'p',
    entryModule: 'm',
    maximumTotalActivities: 32,
    modules: [
      {
        key: 'm',
        inputSchema,
        outputSchema: emptySchema(),
        region: {
          key: 'r',
          inputSchema,
          entry,
          outputSchema: emptySchema(),
          exits: [{ outcome: 'ok', outputSchema: emptySchema() }],
          nodes,
        },
      },
    ],
  };
};

export const nonEmptyNodes = (nodes: readonly SourceNode[]): [SourceNode, ...SourceNode[]] => {
  const [first, ...rest] = nodes;
  if (first === undefined) {
    throw new TypeError('Expected at least one source node.');
  }
  return [first, ...rest];
};

export const sourceForNode = (node: SourceNode): PipelineSourcePackage => {
  const source = node.kind === 'end' ? sourceWithNodes([node]) : sourceWithNodes([node, endNode()]);
  if (node.kind !== 'agent') {
    return source;
  }
  const module = source.modules[0];
  if (module === undefined) {
    throw new TypeError('Expected a source module.');
  }
  const inputSchema: ValueSchema = {
    type: 'object',
    properties: { prompt: { type: 'string' } },
    required: ['prompt'],
    additionalProperties: false,
  };
  return {
    ...source,
    modules: [
      {
        ...module,
        inputSchema,
        region: { ...module.region, inputSchema },
      },
    ],
  };
};

export const agentSource = (): PipelineSourcePackage => ({
  ...sourceForNode({ ...sourceNodeBuilders.agent(), id: 'a' }),
  maximumTotalActivities: 1,
});

export const clone = <Value>(value: Value): Value => structuredClone(value);
