import { describe, expect, test, vi } from 'vitest';

import { compilePipeline } from '../../../src/definition/index.js';
import type {
  CandidateVerdict,
  CompiledPipeline,
  ConsensusPolicy,
  GateResolution,
  JoinPolicy,
  NodeFact,
  PipelineDefinition,
  PipelineFacts,
} from '../../../src/spec/index.js';
import { decidePipeline, decodeCompiledPipeline } from '../../../src/transition/index.js';

const validateCompiledPipeline = (input: unknown) => {
  const decoded = decodeCompiledPipeline(input);
  return decoded.ok ? decoded : { ok: false as const };
};

const taskRoutes = (to: string) => ({
  cancelled: to,
  completed: to,
  failed: to,
  skipped: to,
});

const compile = (definition: PipelineDefinition): CompiledPipeline => {
  const result = compilePipeline(definition);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.faults));
  }
  return result.pipeline;
};

const facts = (
  nodes: readonly NodeFact[] = [],
  candidateVerdicts: readonly CandidateVerdict[] = [],
  gateResolutions: readonly GateResolution[] = [],
): PipelineFacts => ({
  values: [],
  nodes,
  candidateVerdicts,
  gateResolutions,
});

const joinPipeline = (policy: JoinPolicy): CompiledPipeline =>
  compile({
    schemaVersion: 1,
    entry: 'fork',
    facts: [],
    nodes: [
      {
        kind: 'fork',
        key: 'fork',
        join: 'join',
        branches: [
          { name: 'a', entry: 'a', exit: 'a' },
          { name: 'b', entry: 'b', exit: 'b' },
        ],
      },
      { kind: 'task', key: 'a', outcomes: taskRoutes('join') },
      { kind: 'task', key: 'b', outcomes: taskRoutes('join') },
      {
        kind: 'join',
        key: 'join',
        fork: 'fork',
        policy,
        outcomes: { completed: 'end', insufficient: 'end', rejected: 'end' },
      },
      { kind: 'terminal', key: 'end', outcome: 'done' },
    ],
  });

type ExitState = 'completed' | 'failed' | 'cancelled' | 'skipped' | 'pending';

const exitState = (value: string): ExitState => {
  if (
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled' ||
    value === 'skipped' ||
    value === 'pending'
  ) {
    return value;
  }
  throw new Error(`Invalid test exit state: ${value}`);
};

const joinFacts = (left: ExitState, right: ExitState): readonly NodeFact[] => [
  { key: 'fork', state: 'terminal', outcome: 'forked' },
  ...(left === 'pending'
    ? [{ key: 'a', state: 'enabled' } as const]
    : [{ key: 'a', state: 'terminal', outcome: left } as const]),
  ...(right === 'pending'
    ? [{ key: 'b', state: 'enabled' } as const]
    : [{ key: 'b', state: 'terminal', outcome: right } as const]),
  { key: 'join', state: 'enabled' },
];

const expectedJoinOutcome = (
  policy: JoinPolicy,
  states: readonly ExitState[],
): 'completed' | 'insufficient' | 'rejected' | undefined => {
  const accepted = states.filter((state) => state === 'completed').length;
  const pending = states.filter((state) => state === 'pending').length;
  const rejected = states.some((state) => state === 'failed' || state === 'cancelled');
  if (policy.kind === 'all') {
    if (rejected) {
      return 'rejected';
    }
    if (pending > 0) {
      return undefined;
    }
    return accepted > 0 ? 'completed' : 'insufficient';
  }
  if (policy.kind === 'any') {
    if (accepted > 0) {
      return 'completed';
    }
    if (pending > 0) {
      return undefined;
    }
    return rejected ? 'rejected' : 'insufficient';
  }
  if (accepted >= policy.count) {
    return 'completed';
  }
  if (accepted + pending >= policy.count) {
    return undefined;
  }
  return rejected ? 'rejected' : 'insufficient';
};

const consensusPipeline = (policy: ConsensusPolicy): CompiledPipeline =>
  compile({
    schemaVersion: 1,
    entry: 'vote',
    facts: [],
    nodes: [
      {
        kind: 'consensus',
        key: 'vote',
        candidates: ['a', 'b', 'c'],
        policy,
        outcomes: {
          approved: 'end',
          insufficient: 'end',
          rejected: 'end',
          tied: 'end',
        },
      },
      { kind: 'terminal', key: 'end', outcome: 'done' },
    ],
  });

const verdicts = (...values: readonly CandidateVerdict['verdict'][]): CandidateVerdict[] =>
  values.map((verdict, index) => ({
    nodeKey: 'vote',
    candidate: ['a', 'b', 'c'][index] ?? 'a',
    verdict,
  }));

const verdictList = (values: readonly string[]): CandidateVerdict['verdict'][] =>
  values.map((value) => {
    if (value === 'approve' || value === 'reject' || value === 'abstain') {
      return value;
    }
    throw new Error(`Invalid test verdict: ${value}`);
  });

describe('fork and join coordination', () => {
  test('fork fans out once in topological order and never reactivates present targets', () => {
    const pipeline = joinPipeline({ kind: 'all' });
    const enabled: NodeFact[] = [{ key: 'fork', state: 'enabled' }];
    const decision = decidePipeline(pipeline, facts(enabled));
    expect(decision).toEqual({
      kind: 'select',
      nodeKey: 'fork',
      outcome: 'forked',
      activate: ['a', 'b', 'join'],
    });
    expect(decidePipeline(pipeline, facts(enabled))).toEqual(decision);

    expect(
      decidePipeline(
        pipeline,
        facts([
          { key: 'fork', state: 'terminal', outcome: 'forked' },
          { key: 'a', state: 'enabled' },
          { key: 'b', state: 'enabled' },
          { key: 'join', state: 'enabled' },
        ]),
      ),
    ).toEqual({ kind: 'wait', nodeKey: 'a', reason: 'task-incomplete' });
  });

  test('terminal fork requires every entry and join atomically', () => {
    expect(
      decidePipeline(
        joinPipeline({ kind: 'all' }),
        facts([{ key: 'fork', state: 'terminal', outcome: 'forked' }]),
      ),
    ).toMatchObject({ kind: 'reject', faults: [{ code: 'FACT_CAUSAL' }] });
  });

  test('characterizes entry-omitted fork and pre-activation omitted join states plus enabled and terminal facts', () => {
    const pipeline = joinPipeline({ kind: 'all' });

    expect(decidePipeline(pipeline, facts())).toEqual({
      kind: 'activate',
      cause: { kind: 'entry' },
      nodeKeys: ['fork'],
    });
    expect(decidePipeline(pipeline, facts([{ key: 'fork', state: 'enabled' }]))).toEqual({
      kind: 'select',
      nodeKey: 'fork',
      outcome: 'forked',
      activate: ['a', 'b', 'join'],
    });
    expect(
      decidePipeline(
        pipeline,
        facts([
          { key: 'fork', state: 'terminal', outcome: 'forked' },
          { key: 'a', state: 'enabled' },
          { key: 'b', state: 'enabled' },
          { key: 'join', state: 'enabled' },
        ]),
      ),
    ).toEqual({ kind: 'wait', nodeKey: 'a', reason: 'task-incomplete' });

    expect(decidePipeline(pipeline, facts(joinFacts('completed', 'completed')))).toEqual({
      kind: 'select',
      nodeKey: 'join',
      outcome: 'completed',
      activate: ['end'],
    });
    expect(
      decidePipeline(
        pipeline,
        facts([
          { key: 'fork', state: 'terminal', outcome: 'forked' },
          { key: 'a', state: 'terminal', outcome: 'completed' },
          { key: 'b', state: 'terminal', outcome: 'completed' },
          { key: 'join', state: 'terminal', outcome: 'completed' },
          { key: 'end', state: 'enabled' },
        ]),
      ),
    ).toEqual({ kind: 'terminal', nodeKey: 'end', outcome: 'done' });
  });

  test.each([
    [{ kind: 'all' } as const, 'completed', 'skipped', 'completed'],
    [{ kind: 'all' } as const, 'skipped', 'skipped', 'insufficient'],
    [{ kind: 'all' } as const, 'failed', 'pending', 'rejected'],
    [{ kind: 'all' } as const, 'cancelled', 'skipped', 'rejected'],
    [{ kind: 'any', remaining: 'unconstrained' } as const, 'completed', 'pending', 'completed'],
    [{ kind: 'any', remaining: 'unconstrained' } as const, 'failed', 'skipped', 'rejected'],
    [{ kind: 'any', remaining: 'unconstrained' } as const, 'skipped', 'skipped', 'insufficient'],
    [{ kind: 'threshold', count: 2 } as const, 'completed', 'completed', 'completed'],
    [{ kind: 'threshold', count: 2 } as const, 'failed', 'skipped', 'rejected'],
    [{ kind: 'threshold', count: 2 } as const, 'skipped', 'skipped', 'insufficient'],
  ])('selects join policy outcome for %o with %s/%s', (policy, left, right, outcome) => {
    expect(
      decidePipeline(joinPipeline(policy), facts(joinFacts(exitState(left), exitState(right)))),
    ).toEqual({
      kind: 'select',
      nodeKey: 'join',
      outcome,
      activate: ['end'],
    });
  });

  test.each([
    [{ kind: 'all' } as const, 'completed', 'pending'],
    [{ kind: 'any', remaining: 'unconstrained' } as const, 'skipped', 'pending'],
    [{ kind: 'threshold', count: 2 } as const, 'completed', 'pending'],
  ])('waits while join policy %o remains possible', (policy, left, right) => {
    expect(
      decidePipeline(joinPipeline(policy), facts(joinFacts(exitState(left), exitState(right)))),
    ).toEqual({ kind: 'wait', nodeKey: 'b', reason: 'task-incomplete' });
  });

  test.each([
    { kind: 'all' } as const,
    { kind: 'any', remaining: 'unconstrained' } as const,
    { kind: 'threshold', count: 2 } as const,
  ])('covers every two-branch status partition for join policy $kind', (policy) => {
    const states: readonly ExitState[] = ['completed', 'failed', 'cancelled', 'skipped', 'pending'];
    for (const left of states) {
      for (const right of states) {
        const decision = decidePipeline(joinPipeline(policy), facts(joinFacts(left, right)));
        const outcome = expectedJoinOutcome(policy, [left, right]);
        const expected = outcome
          ? {
              kind: 'select' as const,
              nodeKey: 'join',
              outcome,
              activate: ['end'],
            }
          : {
              kind: 'wait' as const,
              nodeKey: left === 'pending' ? 'a' : 'b',
              reason: 'task-incomplete',
            };
        expect(decision).toEqual(expected);
      }
    }
  });

  test('rejects non-atomic terminal fork and join selections', () => {
    const pipeline = joinPipeline({ kind: 'all' });
    expect(
      decidePipeline(
        pipeline,
        facts([
          { key: 'fork', state: 'terminal', outcome: 'forked' },
          { key: 'join', state: 'enabled' },
        ]),
      ),
    ).toMatchObject({ kind: 'reject', faults: [{ code: 'FACT_CAUSAL' }] });
    expect(
      decidePipeline(
        pipeline,
        facts([
          { key: 'fork', state: 'terminal', outcome: 'forked' },
          { key: 'a', state: 'terminal', outcome: 'completed' },
          { key: 'b', state: 'terminal', outcome: 'skipped' },
          { key: 'join', state: 'terminal', outcome: 'completed' },
        ]),
      ),
    ).toMatchObject({ kind: 'reject', faults: [{ code: 'FACT_CAUSAL' }] });
  });

  test('a reached terminal outranks earlier actionable residual work after an any join', () => {
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'fork',
      facts: [{ key: 'path', type: 'boolean' }],
      nodes: [
        {
          kind: 'fork',
          key: 'fork',
          join: 'join',
          branches: [
            { name: 'accepted', entry: 'accepted', exit: 'accepted' },
            { name: 'residual', entry: 'choose', exit: 'residual' },
          ],
        },
        { kind: 'task', key: 'accepted', outcomes: taskRoutes('join') },
        {
          kind: 'branch',
          key: 'choose',
          fact: 'path',
          cases: [{ name: 'continue', when: { op: 'equals', value: true }, to: 'residual' }],
          default: { name: 'stop', to: 'residual' },
        },
        { kind: 'task', key: 'residual', outcomes: taskRoutes('join') },
        {
          kind: 'join',
          key: 'join',
          fork: 'fork',
          policy: { kind: 'any', remaining: 'unconstrained' },
          outcomes: { completed: 'end', insufficient: 'end', rejected: 'end' },
        },
        { kind: 'terminal', key: 'end', outcome: 'done' },
      ],
    });
    const input: PipelineFacts = {
      values: [{ key: 'path', value: true }],
      nodes: [
        { key: 'fork', state: 'terminal', outcome: 'forked' },
        { key: 'accepted', state: 'terminal', outcome: 'completed' },
        { key: 'choose', state: 'enabled' },
        { key: 'join', state: 'terminal', outcome: 'completed' },
        { key: 'end', state: 'enabled' },
      ],
      candidateVerdicts: [],
      gateResolutions: [],
    };

    expect(decidePipeline(pipeline, input)).toEqual({
      kind: 'terminal',
      nodeKey: 'end',
      outcome: 'done',
    });
  });

  test('JSON-round-tripped coordination graph retains exact region integrity', () => {
    const pipeline = joinPipeline({ kind: 'all' });
    const roundTrip: unknown = JSON.parse(JSON.stringify(pipeline));
    expect(validateCompiledPipeline(roundTrip).ok).toBe(true);
    const tampered = structuredClone(pipeline);
    Reflect.set(tampered.forkRegions[0]!.branches[0]!, 'members', []);
    expect(validateCompiledPipeline(tampered)).toEqual({ ok: false });
    const plausible = structuredClone(pipeline);
    const members = plausible.forkRegions[0]?.branches[0]?.members ?? [];
    Reflect.set(
      plausible.forkRegions[0]!.branches[0]!,
      'members',
      members.map((member, index) => (index === members.length - 1 ? 'fork' : member)),
    );
    expect(validateCompiledPipeline(plausible)).toEqual({ ok: false });
  });

  test.each([
    [
      'readiness role',
      (pipeline: CompiledPipeline) => {
        const readiness = pipeline.edges.find((edge) => edge.role === 'readiness');
        if (readiness) {
          Reflect.set(readiness, 'role', 'activation');
        }
      },
    ],
    [
      'readiness owner',
      (pipeline: CompiledPipeline) => {
        const readiness = pipeline.edges.find((edge) => edge.role === 'readiness');
        if (readiness) {
          Reflect.set(readiness, 'fork', null);
        }
      },
    ],
    [
      'region branch identity',
      (pipeline: CompiledPipeline) =>
        Reflect.set(pipeline.forkRegions[0]!.branches[0]!, 'name', 'invented'),
    ],
    [
      'join threshold',
      (pipeline: CompiledPipeline) => {
        const join = pipeline.nodes.find((node) => node.kind === 'join');
        if (join?.kind === 'join') {
          Reflect.set(join, 'policy', { kind: 'threshold', count: 3 });
        }
      },
    ],
  ])('rejects coordination integrity tamper: %s', (_label, mutate) => {
    const pipeline = structuredClone(joinPipeline({ kind: 'threshold', count: 2 }));
    mutate(pipeline);
    expect(validateCompiledPipeline(pipeline)).toEqual({ ok: false });
    expect(decidePipeline(pipeline, facts())).toMatchObject({
      kind: 'reject',
      faults: [{ code: 'PIPELINE_INVALID' }],
    });
  });

  test('builds one value index for a maximum-width fork of enabled branches', () => {
    const branchKeys = Array.from(
      { length: 32 },
      (_, index) => `branch-${String(index).padStart(2, '0')}`,
    );
    const unrelatedKeys = Array.from(
      { length: 96 },
      (_, index) => `unrelated-${String(index).padStart(2, '0')}`,
    );
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'fork',
      facts: [
        ...branchKeys.map((key) => ({ key, type: 'number' as const })),
        ...unrelatedKeys.map((key) => ({ key, type: 'number' as const })),
      ],
      nodes: [
        {
          kind: 'fork',
          key: 'fork',
          join: 'join',
          branches: branchKeys.map((key, index) => ({
            name: key,
            entry: key,
            exit: `exit-${String(index).padStart(2, '0')}`,
          })),
        },
        ...branchKeys.map((key, index) => ({
          kind: 'branch' as const,
          key,
          fact: key,
          cases: [
            {
              name: 'selected',
              when: { op: 'equals' as const, value: 1 },
              to: `exit-${String(index).padStart(2, '0')}`,
            },
          ],
          default: {
            name: 'other',
            to: `exit-${String(index).padStart(2, '0')}`,
          },
        })),
        ...branchKeys.map((_key, index) => ({
          kind: 'task' as const,
          key: `exit-${String(index).padStart(2, '0')}`,
          outcomes: taskRoutes('join'),
        })),
        {
          kind: 'join',
          key: 'join',
          fork: 'fork',
          policy: { kind: 'all' },
          outcomes: { completed: 'end', insufficient: 'end', rejected: 'end' },
        },
        { kind: 'terminal', key: 'end', outcome: 'done' },
      ],
    });
    const nodeFacts: NodeFact[] = [
      { key: 'fork', state: 'terminal', outcome: 'forked' },
      ...branchKeys.map((key) => ({ key, state: 'enabled' as const })),
      { key: 'join', state: 'enabled' },
    ];
    const mapSetSpy = vi.spyOn(Map.prototype, 'set');
    try {
      expect(
        decidePipeline(pipeline, {
          values: unrelatedKeys.map((key, value) => ({ key, value })),
          nodes: nodeFacts,
          candidateVerdicts: [],
          gateResolutions: [],
        }),
      ).toEqual({
        kind: 'wait',
        nodeKey: 'branch-00',
        reason: 'branch-fact-missing',
      });
      const indexedValueInsertions = mapSetSpy.mock.calls.filter(
        ([key, value]) =>
          typeof key === 'string' && key.startsWith('unrelated-') && typeof value === 'number',
      );
      expect(indexedValueInsertions).toHaveLength(96);
    } finally {
      mapSetSpy.mockRestore();
    }
  });
});

describe('consensus coordination', () => {
  test('characterizes omitted, enabled, and terminal fact states for consensus nodes', () => {
    const pipeline = consensusPipeline({ kind: 'unanimous' });

    expect(decidePipeline(pipeline, facts())).toEqual({
      kind: 'activate',
      cause: { kind: 'entry' },
      nodeKeys: ['vote'],
    });
    expect(decidePipeline(pipeline, facts([{ key: 'vote', state: 'enabled' }]))).toEqual({
      kind: 'wait',
      nodeKey: 'vote',
      reason: 'consensus-incomplete',
    });
    expect(
      decidePipeline(
        pipeline,
        facts(
          [
            { key: 'vote', state: 'terminal', outcome: 'approved' },
            { key: 'end', state: 'enabled' },
          ],
          verdicts('approve', 'approve', 'approve'),
        ),
      ),
    ).toEqual({ kind: 'terminal', nodeKey: 'end', outcome: 'done' });
  });

  test.each([
    [{ kind: 'unanimous' } as const, ['reject'], 'rejected'],
    [{ kind: 'unanimous' } as const, ['approve', 'approve', 'approve'], 'approved'],
    [{ kind: 'unanimous' } as const, ['approve', 'abstain', 'approve'], 'insufficient'],
    [{ kind: 'quorum', quorum: 2 } as const, ['approve', 'approve', 'reject'], 'approved'],
    [{ kind: 'quorum', quorum: 2 } as const, ['reject', 'reject', 'approve'], 'rejected'],
    [{ kind: 'quorum', quorum: 2 } as const, ['approve', 'reject', 'abstain'], 'tied'],
    [{ kind: 'quorum', quorum: 2 } as const, ['approve', 'abstain', 'abstain'], 'insufficient'],
    [{ kind: 'threshold', approve: 2, reject: 2 } as const, ['approve', 'approve'], 'approved'],
    [{ kind: 'threshold', approve: 2, reject: 2 } as const, ['reject', 'reject'], 'rejected'],
    [{ kind: 'threshold', approve: 3, reject: 2 } as const, ['approve', 'abstain'], 'insufficient'],
  ])('selects consensus policy %o outcome %s', (policy, input, outcome) => {
    const pipeline = consensusPipeline(policy);
    expect(
      decidePipeline(
        pipeline,
        facts([{ key: 'vote', state: 'enabled' }], verdicts(...verdictList(input))),
      ),
    ).toEqual({ kind: 'select', nodeKey: 'vote', outcome, activate: ['end'] });
  });

  test('compiles and evaluates slash and tilde candidate semantic names consistently', () => {
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'vote',
      facts: [],
      nodes: [
        {
          kind: 'consensus',
          key: 'vote',
          candidates: ['/', '~'],
          policy: { kind: 'unanimous' },
          outcomes: { approved: 'end', insufficient: 'end', rejected: 'end', tied: 'end' },
        },
        { kind: 'terminal', key: 'end', outcome: 'done' },
      ],
    });

    expect(
      decidePipeline(
        pipeline,
        facts(
          [{ key: 'vote', state: 'enabled' }],
          [
            { nodeKey: 'vote', candidate: '/', verdict: 'approve' },
            { nodeKey: 'vote', candidate: '~', verdict: 'approve' },
          ],
        ),
      ),
    ).toEqual({ kind: 'select', nodeKey: 'vote', outcome: 'approved', activate: ['end'] });
  });

  test.each([
    [{ kind: 'unanimous' } as const, ['approve']],
    [{ kind: 'quorum', quorum: 2 } as const, ['approve', 'approve']],
    [{ kind: 'threshold', approve: 2, reject: 2 } as const, ['approve']],
  ])('waits for incomplete consensus policy %o', (policy, input) => {
    expect(
      decidePipeline(
        consensusPipeline(policy),
        facts([{ key: 'vote', state: 'enabled' }], verdicts(...verdictList(input))),
      ),
    ).toEqual({ kind: 'wait', nodeKey: 'vote', reason: 'consensus-incomplete' });
  });

  test('rejects duplicate, foreign, undeclared and premature verdicts deterministically', () => {
    const pipeline = consensusPipeline({ kind: 'unanimous' });
    const decision = decidePipeline(
      pipeline,
      facts(
        [],
        [
          { nodeKey: 'vote', candidate: 'a', verdict: 'approve' },
          { nodeKey: 'vote', candidate: 'a', verdict: 'reject' },
          { nodeKey: 'vote', candidate: 'foreign', verdict: 'approve' },
        ],
      ),
    );
    expect(decision.kind).toBe('reject');
    if (decision.kind !== 'reject') {
      return;
    }
    expect(decision.faults.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['FACT_DUPLICATE', 'FACT_CANDIDATE', 'FACT_PREMATURE']),
    );
  });

  test('prunes duplicate verdicts before consensus aggregation', () => {
    const decision = decidePipeline(
      consensusPipeline({ kind: 'unanimous' }),
      facts(
        [{ key: 'vote', state: 'enabled' }],
        [
          { nodeKey: 'vote', candidate: 'a', verdict: 'approve' },
          { nodeKey: 'vote', candidate: 'a', verdict: 'reject' },
        ],
      ),
    );

    expect(decision).toEqual({
      kind: 'reject',
      faults: [
        {
          code: 'FACT_DUPLICATE',
          path: '/candidateVerdicts/1',
          message: 'Duplicate candidate verdict fact.',
        },
      ],
    });
  });

  test('preserves the source index of a premature verdict after an invalid entry', () => {
    const decision = decidePipeline(
      consensusPipeline({ kind: 'unanimous' }),
      facts(
        [],
        [
          { nodeKey: 'vote', candidate: 'foreign', verdict: 'approve' },
          { nodeKey: 'vote', candidate: 'a', verdict: 'approve' },
        ],
      ),
    );
    const premature =
      decision.kind === 'reject'
        ? decision.faults.find((fault) => fault.code === 'FACT_PREMATURE')
        : undefined;
    expect(premature).toEqual({
      code: 'FACT_PREMATURE',
      path: '/candidateVerdicts/1',
      message: 'Verdict node is not activated.',
    });
  });

  test('indexes the maximum candidate set once instead of rescanning it per consensus node', () => {
    const candidates = Array.from({ length: 32 }, (_, index) => `candidate-${index}`);
    const consensusNodes = Array.from({ length: 32 }, (_, index) => ({
      kind: 'consensus' as const,
      key: `vote-${String(index).padStart(2, '0')}`,
      candidates,
      policy: { kind: 'unanimous' as const },
      outcomes: {
        approved: index === 31 ? 'end' : `vote-${String(index + 1).padStart(2, '0')}`,
        insufficient: 'end',
        rejected: 'end',
        tied: 'end',
      },
    }));
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'vote-00',
      facts: [],
      nodes: [...consensusNodes, { kind: 'terminal', key: 'end', outcome: 'done' }],
    });
    const nodeFacts: NodeFact[] = [
      ...consensusNodes.map((node) => ({
        key: node.key,
        state: 'terminal' as const,
        outcome: 'approved',
      })),
      { key: 'end', state: 'enabled' },
    ];
    const candidateVerdicts: CandidateVerdict[] = consensusNodes.flatMap((node) =>
      candidates.map((candidate) => ({
        nodeKey: node.key,
        candidate,
        verdict: 'approve',
      })),
    );
    const filterSpy = vi.spyOn(Array.prototype, 'filter');
    try {
      expect(decidePipeline(pipeline, facts(nodeFacts, candidateVerdicts))).toEqual({
        kind: 'terminal',
        nodeKey: 'end',
        outcome: 'done',
      });
      const inspectedElements = filterSpy.mock.instances.reduce<number>(
        (total, instance) => total + (Array.isArray(instance) ? instance.length : 0),
        0,
      );
      expect(inspectedElements).toBeLessThan(10_000);
    } finally {
      filterSpy.mockRestore();
    }
  });
});

describe('human gate coordination', () => {
  const pipeline = compile({
    schemaVersion: 1,
    entry: 'gate',
    facts: [],
    nodes: [
      {
        kind: 'humanGate',
        key: 'gate',
        subject: 'Approve?',
        resolutions: [
          { resolution: 'approved', to: 'yes' },
          { resolution: 'cancelled', to: 'no' },
          { resolution: 'rejected', to: 'no' },
        ],
      },
      { kind: 'terminal', key: 'no', outcome: 'no' },
      { kind: 'terminal', key: 'yes', outcome: 'yes' },
    ],
  });

  test('characterizes omitted, enabled, and terminal fact states for human-gate nodes', () => {
    expect(decidePipeline(pipeline, facts())).toEqual({
      kind: 'activate',
      cause: { kind: 'entry' },
      nodeKeys: ['gate'],
    });
    expect(decidePipeline(pipeline, facts([{ key: 'gate', state: 'enabled' }]))).toEqual({
      kind: 'wait',
      nodeKey: 'gate',
      reason: 'gate-unresolved',
    });
    expect(
      decidePipeline(
        pipeline,
        facts(
          [
            { key: 'gate', state: 'terminal', outcome: 'approved' },
            { key: 'yes', state: 'enabled' },
          ],
          [],
          [{ nodeKey: 'gate', resolution: 'approved' }],
        ),
      ),
    ).toEqual({ kind: 'terminal', nodeKey: 'yes', outcome: 'yes' });
  });

  test('waits unresolved and selects every declared resolution', () => {
    expect(decidePipeline(pipeline, facts([{ key: 'gate', state: 'enabled' }]))).toEqual({
      kind: 'wait',
      nodeKey: 'gate',
      reason: 'gate-unresolved',
    });
    for (const [resolution, target] of [
      ['approved', 'yes'],
      ['cancelled', 'no'],
      ['rejected', 'no'],
    ] as const) {
      expect(
        decidePipeline(
          pipeline,
          facts([{ key: 'gate', state: 'enabled' }], [], [{ nodeKey: 'gate', resolution }]),
        ),
      ).toEqual({
        kind: 'select',
        nodeKey: 'gate',
        outcome: resolution,
        activate: [target],
      });
    }
  });

  test('rejects invalid, duplicate, foreign and premature resolutions', () => {
    const decision = decidePipeline(
      pipeline,
      facts(
        [],
        [],
        [
          { nodeKey: 'gate', resolution: 'foreign' },
          { nodeKey: 'gate', resolution: 'foreign' },
        ],
      ),
    );
    expect(decision.kind).toBe('reject');
    if (decision.kind !== 'reject') {
      return;
    }
    expect(decision.faults.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['FACT_DUPLICATE', 'FACT_RESOLUTION']),
    );
  });

  test('prunes a duplicate resolution after an invalid sibling before causal evaluation', () => {
    const decision = decidePipeline(
      pipeline,
      facts(
        [],
        [],
        [
          { nodeKey: 'gate', resolution: 'foreign' },
          { nodeKey: 'gate', resolution: 'approved' },
        ],
      ),
    );
    expect(decision).toEqual({
      kind: 'reject',
      faults: [
        {
          code: 'FACT_DUPLICATE',
          path: '/gateResolutions/1',
          message: 'Duplicate gate resolution fact.',
        },
        {
          code: 'FACT_RESOLUTION',
          path: '/gateResolutions/0/resolution',
          message: 'Resolution is not declared.',
        },
      ],
    });
  });

  test('terminal gate replays its declared resolution and requires the routed target', () => {
    const resolution = [{ nodeKey: 'gate', resolution: 'approved' }] as const;
    expect(
      decidePipeline(
        pipeline,
        facts([{ key: 'gate', state: 'terminal', outcome: 'approved' }], [], resolution),
      ),
    ).toMatchObject({ kind: 'reject', faults: [{ code: 'FACT_CAUSAL' }] });
    expect(
      decidePipeline(
        pipeline,
        facts(
          [
            { key: 'gate', state: 'terminal', outcome: 'approved' },
            { key: 'yes', state: 'enabled' },
          ],
          [],
          resolution,
        ),
      ),
    ).toEqual({ kind: 'terminal', nodeKey: 'yes', outcome: 'yes' });
  });
});

describe('all-seven-node pure scenario', () => {
  test('keeps non-entry omissions inert and progresses without hidden coordination state', () => {
    const pipeline = compile({
      schemaVersion: 1,
      entry: 'choose',
      facts: [{ key: 'path', type: 'boolean' }],
      nodes: [
        {
          kind: 'branch',
          key: 'choose',
          fact: 'path',
          cases: [{ name: 'parallel', when: { op: 'equals', value: true }, to: 'fork' }],
          default: { name: 'stop', to: 'end' },
        },
        {
          kind: 'fork',
          key: 'fork',
          join: 'join',
          branches: [
            { name: 'a', entry: 'a', exit: 'a' },
            { name: 'b', entry: 'b', exit: 'b' },
          ],
        },
        { kind: 'task', key: 'a', outcomes: taskRoutes('join') },
        { kind: 'task', key: 'b', outcomes: taskRoutes('join') },
        {
          kind: 'join',
          key: 'join',
          fork: 'fork',
          policy: { kind: 'all' },
          outcomes: { completed: 'vote', insufficient: 'end', rejected: 'end' },
        },
        {
          kind: 'consensus',
          key: 'vote',
          candidates: ['alice', 'bob'],
          policy: { kind: 'quorum', quorum: 2 },
          outcomes: {
            approved: 'gate',
            insufficient: 'end',
            rejected: 'end',
            tied: 'end',
          },
        },
        {
          kind: 'humanGate',
          key: 'gate',
          subject: 'Release?',
          resolutions: [
            { resolution: 'approved', to: 'end' },
            { resolution: 'rejected', to: 'end' },
          ],
        },
        { kind: 'terminal', key: 'end', outcome: 'done' },
      ],
    });
    const valueFacts = [{ key: 'path', value: true }] as const;
    expect(decidePipeline(pipeline, facts([{ key: 'choose', state: 'enabled' }]))).toEqual({
      kind: 'wait',
      nodeKey: 'choose',
      reason: 'branch-fact-missing',
    });
    const base: NodeFact[] = [
      { key: 'choose', state: 'terminal', outcome: 'parallel' },
      { key: 'fork', state: 'terminal', outcome: 'forked' },
      { key: 'a', state: 'terminal', outcome: 'completed' },
      { key: 'b', state: 'terminal', outcome: 'skipped' },
      { key: 'join', state: 'terminal', outcome: 'completed' },
    ];
    const approvals: CandidateVerdict[] = [
      { nodeKey: 'vote', candidate: 'alice', verdict: 'approve' },
      { nodeKey: 'vote', candidate: 'bob', verdict: 'approve' },
    ];
    const beforeVote: PipelineFacts = {
      values: valueFacts,
      nodes: [...base, { key: 'vote', state: 'enabled' }],
      candidateVerdicts: [],
      gateResolutions: [],
    };
    expect(decidePipeline(pipeline, beforeVote)).toEqual({
      kind: 'wait',
      nodeKey: 'vote',
      reason: 'consensus-incomplete',
    });

    const voteReady: PipelineFacts = { ...beforeVote, candidateVerdicts: approvals };
    const voteDecision = decidePipeline(pipeline, voteReady);
    expect(voteDecision).toEqual({
      kind: 'select',
      nodeKey: 'vote',
      outcome: 'approved',
      activate: ['gate'],
    });
    expect(decidePipeline(pipeline, voteReady)).toEqual(voteDecision);

    const gateReady: PipelineFacts = {
      values: valueFacts,
      nodes: [
        ...base,
        { key: 'vote', state: 'terminal', outcome: 'approved' },
        { key: 'gate', state: 'enabled' },
      ],
      candidateVerdicts: approvals,
      gateResolutions: [],
    };
    expect(decidePipeline(pipeline, gateReady)).toEqual({
      kind: 'wait',
      nodeKey: 'gate',
      reason: 'gate-unresolved',
    });
    const resolved: PipelineFacts = {
      ...gateReady,
      gateResolutions: [{ nodeKey: 'gate', resolution: 'approved' }],
    };
    const snapshot = structuredClone(resolved);
    expect(decidePipeline(pipeline, resolved)).toEqual({
      kind: 'select',
      nodeKey: 'gate',
      outcome: 'approved',
      activate: ['end'],
    });
    expect(resolved).toEqual(snapshot);

    expect(
      decidePipeline(pipeline, {
        ...resolved,
        nodes: [
          ...base,
          { key: 'vote', state: 'terminal', outcome: 'approved' },
          { key: 'gate', state: 'terminal', outcome: 'approved' },
          { key: 'end', state: 'enabled' },
        ],
      }),
    ).toEqual({ kind: 'terminal', nodeKey: 'end', outcome: 'done' });
  });

  test('is invariant to candidate-fact permutation and rejects selector contradictions', () => {
    const pipeline = consensusPipeline({ kind: 'unanimous' });
    const nodes: NodeFact[] = [
      { key: 'vote', state: 'terminal', outcome: 'approved' },
      { key: 'end', state: 'enabled' },
    ];
    const approved = verdicts('approve', 'approve', 'approve');
    expect(decidePipeline(pipeline, facts(nodes, approved))).toEqual(
      decidePipeline(pipeline, facts(nodes, [...approved].reverse())),
    );
    expect(
      decidePipeline(pipeline, facts(nodes, verdicts('reject', 'approve', 'approve'))),
    ).toMatchObject({
      kind: 'reject',
      faults: [{ code: 'FACT_OUTCOME', path: '/nodes/0/outcome' }],
    });
  });
});
