import { describe, expect, it } from 'vitest';

import type {
  GenericParallelBranchResult,
  ProgramParallelBranch,
  ProgramParallelNode,
  ProgramVoteBranch,
  VoteParallelBranchResult,
} from '../../src/program/index.js';
import { classifyGenericParallel, classifyVoteParallel } from '../support/kernel-internal.js';
import { programRegion } from '../support/program-builders.js';

const genericBranch = (key: string): ProgramParallelBranch => ({
  key,
  input: {},
  region: programRegion(),
  exits: [
    { outcome: 'd', classification: 'doesNotQualify' },
    { outcome: 'q', classification: 'qualifies' },
  ],
});

const voteBranch = (key: string): ProgramVoteBranch => ({
  key,
  bindingKey: key,
  input: {},
  region: programRegion(),
});

const genericNode = (
  policy: Extract<ProgramParallelNode, { mode: 'generic' }>['policy'],
): Extract<ProgramParallelNode, { mode: 'generic' }> => ({
  kind: 'parallel',
  id: `sha256:${'1'.repeat(64)}`,
  mode: 'generic',
  branches: [genericBranch('a'), genericBranch('b'), genericBranch('c')],
  policy,
  remaining: 'drain',
  next: `sha256:${'2'.repeat(64)}`,
});

const completed = (outcome: 'q' | 'd'): GenericParallelBranchResult => ({
  status: 'completed',
  outcome,
  output: {},
});

describe('structured parallel policies', () => {
  it.each([
    [{ kind: 'all' }, { a: completed('q'), b: completed('q'), c: completed('q') }, 'completed'],
    [{ kind: 'all' }, { a: completed('d') }, 'impossible'],
    [{ kind: 'any' }, { a: completed('q') }, 'completed'],
    [{ kind: 'any' }, { a: completed('d'), b: completed('d'), c: completed('d') }, 'impossible'],
    [{ kind: 'threshold', count: 2 }, { a: completed('q'), b: completed('q') }, 'completed'],
    [
      { kind: 'threshold', count: 2 },
      { a: completed('q'), b: completed('d'), c: completed('d') },
      'impossible',
    ],
  ] as const)('classifies generic %j siblings', (policy, results, expected) => {
    expect(classifyGenericParallel(genericNode(policy), results, null)).toBe(expected);
  });

  it.each([{ kind: 'all' }, { kind: 'any' }, { kind: 'threshold', count: 2 }] as const)(
    'classifies isolated generic cancellation as failure for %j',
    (policy) => {
      const node = genericNode(policy);
      expect(
        classifyGenericParallel(
          node,
          {
            a: { status: 'failed', failure: { code: 'x', path: '' } },
          },
          null,
        ),
      ).toBe('failed');
      expect(classifyGenericParallel(node, { a: { status: 'cancelled' } }, null)).toBe('failed');
    },
  );

  const voteNode = (
    policy: Extract<ProgramParallelNode, { mode: 'votes' }>['policy'],
  ): Extract<ProgramParallelNode, { mode: 'votes' }> => ({
    kind: 'parallel',
    id: `sha256:${'3'.repeat(64)}`,
    mode: 'votes',
    branches: [voteBranch('a'), voteBranch('b'), voteBranch('c')],
    policy,
    remaining: 'drain',
    next: `sha256:${'4'.repeat(64)}`,
  });

  const votes = (
    values: readonly ('approve' | 'reject' | 'abstain')[],
  ): Readonly<Record<string, VoteParallelBranchResult>> =>
    Object.fromEntries(
      values.map((vote, index) => [String.fromCharCode(97 + index), { status: 'vote', vote }]),
    );

  it.each([
    [{ kind: 'unanimous' }, ['approve', 'approve', 'approve'], 'approved'],
    [{ kind: 'unanimous' }, ['reject'], 'rejected'],
    [{ kind: 'unanimous' }, ['approve', 'approve', 'abstain'], 'inconclusive'],
    [{ kind: 'quorum', minimumParticipation: 2 }, ['approve', 'approve', 'abstain'], 'approved'],
    [{ kind: 'quorum', minimumParticipation: 2 }, ['approve', 'reject', 'abstain'], 'inconclusive'],
    [
      { kind: 'independentThreshold', approveThreshold: 2, rejectThreshold: 2 },
      ['approve', 'approve'],
      'approved',
    ],
    [
      { kind: 'independentThreshold', approveThreshold: 2, rejectThreshold: 2 },
      ['reject', 'reject'],
      'rejected',
    ],
  ] as const)('classifies vote %j siblings', (policy, values, expected) => {
    expect(classifyVoteParallel(voteNode(policy), votes(values), null)).toBe(expected);
  });

  it.each([
    { kind: 'unanimous' },
    { kind: 'quorum', minimumParticipation: 2 },
    { kind: 'independentThreshold', approveThreshold: 2, rejectThreshold: 2 },
  ] as const)('classifies isolated participant cancellation as failure for %j', (policy) => {
    const node = voteNode(policy);
    expect(
      classifyVoteParallel(
        node,
        {
          a: { status: 'failed', failure: { code: 'x', path: '' } },
        },
        null,
      ),
    ).toBe('participantFailed');
    expect(classifyVoteParallel(node, { a: { status: 'cancelled' } }, null)).toBe(
      'participantFailed',
    );
  });
});
