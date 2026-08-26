import { Compile } from 'typebox/compile';
import { describe, expect, it } from 'vitest';

import { ProgramNodeSchema } from '../../../src/program/index.js';
import { programId, programNodeExamples, programRegion } from '../../support/program-builders.js';

const validate = Compile(ProgramNodeSchema);

const without = (value: object, field: string): Record<string, unknown> => {
  const incomplete = { ...value } as Record<string, unknown>;
  delete incomplete[field];
  return incomplete;
};

const [activity, choice, call, parallel, repeat, map, wait, humanGate, end] = programNodeExamples();
if (
  activity?.kind !== 'activity' ||
  choice?.kind !== 'choice' ||
  call?.kind !== 'call' ||
  parallel?.kind !== 'parallel' ||
  parallel.mode !== 'generic' ||
  repeat?.kind !== 'repeat' ||
  map?.kind !== 'map' ||
  wait?.kind !== 'wait' ||
  humanGate?.kind !== 'humanGate' ||
  end?.kind !== 'end'
) {
  throw new TypeError('Expected one fixture for every Program node kind.');
}

const voteParallel = {
  kind: 'parallel',
  id: programId('4'),
  mode: 'votes',
  branches: [
    {
      key: 'reviewer',
      bindingKey: 'reviewer-binding',
      input: {},
      region: programRegion(),
    },
  ],
  policy: { kind: 'quorum', minimumParticipation: 1 },
  remaining: 'cancel',
  next: programId('9'),
} as const;

const signalWait = {
  ...wait,
  wait: { kind: 'signal', signal: 'approved', payloadSchema: { type: 'boolean' } },
} as const;

const invalidNodes = [
  {
    name: 'activity route missing succeeded',
    value: { ...activity, routes: without(activity.routes, 'succeeded') },
  },
  {
    name: 'activity route has unknown field',
    value: { ...activity, routes: { ...activity.routes, retried: programId() } },
  },
  {
    name: 'activity route has wrong target',
    value: { ...activity, routes: { ...activity.routes, failed: 'node-key' } },
  },
  {
    name: 'choice case missing target',
    value: { ...choice, cases: [without(choice.cases[0], 'target')] },
  },
  {
    name: 'choice case has unknown field',
    value: { ...choice, cases: [{ ...choice.cases[0], priority: 1 }] },
  },
  {
    name: 'choice case has wrong domain',
    value: { ...choice, cases: [{ ...choice.cases[0], when: { kind: 'range', minimum: 1 } }] },
  },
  {
    name: 'call outcome missing outcome',
    value: {
      ...call,
      routes: { ...call.routes, outcomes: [without(call.routes.outcomes[0], 'outcome')] },
    },
  },
  {
    name: 'call outcome has unknown field',
    value: {
      ...call,
      routes: { ...call.routes, outcomes: [{ ...call.routes.outcomes[0], retry: true }] },
    },
  },
  {
    name: 'call routes missing failed',
    value: { ...call, routes: without(call.routes, 'failed') },
  },
  {
    name: 'call routes have unknown field',
    value: { ...call, routes: { ...call.routes, timeout: programId() } },
  },
  {
    name: 'generic branch missing input',
    value: {
      ...parallel,
      branches: [without(parallel.branches[0], 'input'), parallel.branches[1]],
    },
  },
  {
    name: 'generic branch has unknown field',
    value: {
      ...parallel,
      branches: [{ ...parallel.branches[0], bindingKey: 'forbidden' }, parallel.branches[1]],
    },
  },
  {
    name: 'generic branch exit missing classification',
    value: {
      ...parallel,
      branches: [
        {
          ...parallel.branches[0],
          exits: [without(parallel.branches[0].exits[0], 'classification')],
        },
        parallel.branches[1],
      ],
    },
  },
  {
    name: 'generic branch exit has unknown field',
    value: {
      ...parallel,
      branches: [
        {
          ...parallel.branches[0],
          exits: [{ ...parallel.branches[0].exits[0], target: programId() }],
        },
        parallel.branches[1],
      ],
    },
  },
  {
    name: 'generic threshold policy missing count',
    value: { ...parallel, policy: { kind: 'threshold' } },
  },
  {
    name: 'generic threshold policy has wrong count',
    value: { ...parallel, policy: { kind: 'threshold', count: 0 } },
  },
  {
    name: 'vote branch missing binding key',
    value: { ...voteParallel, branches: [without(voteParallel.branches[0], 'bindingKey')] },
  },
  {
    name: 'vote branch has unknown exits',
    value: { ...voteParallel, branches: [{ ...voteParallel.branches[0], exits: [] }] },
  },
  {
    name: 'quorum policy missing participation',
    value: { ...voteParallel, policy: { kind: 'quorum' } },
  },
  {
    name: 'independent policy has wrong threshold',
    value: {
      ...voteParallel,
      policy: { kind: 'independentThreshold', approveThreshold: 0, rejectThreshold: 1 },
    },
  },
  {
    name: 'repeat body exit missing classification',
    value: { ...repeat, bodyExits: [without(repeat.bodyExits[0], 'classification')] },
  },
  {
    name: 'repeat body exit has wrong classification',
    value: { ...repeat, bodyExits: [{ ...repeat.bodyExits[0], classification: 'completed' }] },
  },
  {
    name: 'repeat routes missing exhausted',
    value: { ...repeat, routes: without(repeat.routes, 'exhausted') },
  },
  {
    name: 'repeat routes have unknown field',
    value: { ...repeat, routes: { ...repeat.routes, skipped: programId() } },
  },
  {
    name: 'map body exit has wrong classification',
    value: { ...map, bodyExits: [{ ...map.bodyExits[0], classification: 'value' }] },
  },
  {
    name: 'map fail-fast policy missing remaining',
    value: { ...map, failure: { kind: 'failFast' } },
  },
  {
    name: 'map routes have unknown field',
    value: { ...map, routes: { ...map.routes, exhausted: programId() } },
  },
  {
    name: 'signal wait missing payload schema',
    value: { ...signalWait, wait: without(signalWait.wait, 'payloadSchema') },
  },
  {
    name: 'signal wait has unknown field',
    value: { ...signalWait, wait: { ...signalWait.wait, channel: 'host' } },
  },
  {
    name: 'signal wait has wrong payload schema',
    value: { ...signalWait, wait: { ...signalWait.wait, payloadSchema: { type: 'unknown' } } },
  },
  {
    name: 'duration wait has signal field',
    value: { ...wait, wait: { ...wait.wait, signal: 'forbidden' } },
  },
  {
    name: 'gate answer route missing target',
    value: {
      ...humanGate,
      routes: { ...humanGate.routes, answers: [without(humanGate.routes.answers[0], 'target')] },
    },
  },
  {
    name: 'gate answer route has unknown field',
    value: {
      ...humanGate,
      routes: { ...humanGate.routes, answers: [{ ...humanGate.routes.answers[0], actor: 'host' }] },
    },
  },
  {
    name: 'gate missing deadline',
    value: without(humanGate, 'deadline'),
  },
  {
    name: 'gate routes have unknown field',
    value: { ...humanGate, routes: { ...humanGate.routes, escalated: programId() } },
  },
  {
    name: 'end mapping selector missing pointer',
    value: { ...end, output: { value: { kind: 'scopeInput' } } },
  },
  {
    name: 'end mapping selector has unknown field',
    value: { ...end, output: { value: { kind: 'scopeInput', pointer: '', source: 'host' } } },
  },
] as const;

describe('nested Program node contracts', () => {
  it.each(invalidNodes)('rejects $name', ({ value }) => {
    expect(validate.Check(value)).toBe(false);
  });
});
