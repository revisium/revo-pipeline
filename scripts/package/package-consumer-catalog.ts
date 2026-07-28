export type ConsumerCaseId =
  | 'runtime'
  | 'private-runtime'
  | 'positive'
  | 'private'
  | 'default'
  | 'alias'
  | 'subpath'
  | 'host-shaped'
  | 'task-branch-terminal'
  | 'fork-join-consensus-terminal'
  | 'human-gate-terminal-replay'
  | 'decision-growth'
  | 'reduction-growth'
  | 'permission-read'
  | 'permission-write'
  | 'permission-child'
  | 'permission-worker';

export type ConsumerPhase = 'createType' | 'typeScript' | 'createRuntime' | 'executeRuntime';
export type ConsumerExpectedMode = 'success' | `diagnostic:${string}`;

export interface DocumentationCase {
  readonly documentPath: string;
  readonly publicValues: readonly string[];
  readonly nodeKinds: readonly string[];
}

export interface ConsumerCase {
  readonly id: ConsumerCaseId;
  readonly type: {
    readonly sourcePath: string;
    readonly configurationPath: string;
    readonly expected: ConsumerExpectedMode;
    readonly mutation: 'decision-growth' | 'reduction-growth' | null;
  } | null;
  readonly runtime: {
    readonly entryPath: string;
    readonly expected: ConsumerExpectedMode;
    readonly emittedFrom: ConsumerCaseId | null;
  } | null;
  readonly documentation: DocumentationCase | null;
}

const freezeCase = (entry: ConsumerCase): ConsumerCase =>
  Object.freeze({
    ...entry,
    type: entry.type ? Object.freeze(entry.type) : null,
    runtime: entry.runtime ? Object.freeze(entry.runtime) : null,
    documentation: entry.documentation
      ? Object.freeze({
          ...entry.documentation,
          publicValues: Object.freeze([...entry.documentation.publicValues]),
          nodeKinds: Object.freeze([...entry.documentation.nodeKinds]),
        })
      : null,
  });

const CASES: readonly ConsumerCase[] = [
  {
    id: 'runtime',
    type: null,
    runtime: { entryPath: 'consumer.mjs', expected: 'success', emittedFrom: null },
    documentation: null,
  },
  {
    id: 'private-runtime',
    type: null,
    runtime: {
      entryPath: 'private-runtime.mjs',
      expected: 'diagnostic:ERR_PACKAGE_PATH_NOT_EXPORTED',
      emittedFrom: null,
    },
    documentation: null,
  },
  {
    id: 'positive',
    type: {
      sourcePath: 'consumer.ts',
      configurationPath: 'tsconfig.positive.json',
      expected: 'success',
      mutation: null,
    },
    runtime: { entryPath: 'out/consumer.js', expected: 'success', emittedFrom: 'positive' },
    documentation: null,
  },
  {
    id: 'private',
    type: {
      sourcePath: 'private-consumer.ts',
      configurationPath: 'tsconfig.private.json',
      expected: 'diagnostic:TS2307',
      mutation: null,
    },
    runtime: null,
    documentation: null,
  },
  {
    id: 'default',
    type: {
      sourcePath: 'default-consumer.ts',
      configurationPath: 'tsconfig.default.json',
      expected: 'diagnostic:TS1192',
      mutation: null,
    },
    runtime: null,
    documentation: null,
  },
  {
    id: 'alias',
    type: {
      sourcePath: 'alias-consumer.ts',
      configurationPath: 'tsconfig.alias.json',
      expected: 'diagnostic:TS2305',
      mutation: null,
    },
    runtime: null,
    documentation: null,
  },
  {
    id: 'subpath',
    type: {
      sourcePath: 'subpath-consumer.ts',
      configurationPath: 'tsconfig.subpath.json',
      expected: 'diagnostic:TS2307',
      mutation: null,
    },
    runtime: null,
    documentation: null,
  },
  {
    id: 'host-shaped',
    type: {
      sourcePath: 'host-shaped-consumer.ts',
      configurationPath: 'tsconfig.host-shaped.json',
      expected: 'success',
      mutation: null,
    },
    runtime: {
      entryPath: 'out/host-shaped-consumer.js',
      expected: 'success',
      emittedFrom: 'host-shaped',
    },
    documentation: null,
  },
  {
    id: 'task-branch-terminal',
    type: {
      sourcePath: 'examples/task-branch-terminal.ts',
      configurationPath: 'tsconfig.task-branch-terminal.json',
      expected: 'success',
      mutation: null,
    },
    runtime: {
      entryPath: 'out/examples/task-branch-terminal.js',
      expected: 'success',
      emittedFrom: 'task-branch-terminal',
    },
    documentation: {
      documentPath: 'README.md',
      publicValues: ['definePipeline', 'compilePipeline', 'decidePipeline'],
      nodeKinds: ['task', 'branch', 'terminal'],
    },
  },
  {
    id: 'fork-join-consensus-terminal',
    type: {
      sourcePath: 'examples/fork-join-consensus-terminal.ts',
      configurationPath: 'tsconfig.fork-join-consensus-terminal.json',
      expected: 'success',
      mutation: null,
    },
    runtime: {
      entryPath: 'out/examples/fork-join-consensus-terminal.js',
      expected: 'success',
      emittedFrom: 'fork-join-consensus-terminal',
    },
    documentation: {
      documentPath: 'docs/examples/fork-join-consensus-terminal.md',
      publicValues: ['compilePipeline', 'decodeCompiledPipeline', 'reducePipeline'],
      nodeKinds: ['fork', 'join', 'consensus', 'terminal'],
    },
  },
  {
    id: 'human-gate-terminal-replay',
    type: {
      sourcePath: 'examples/human-gate-terminal-replay.ts',
      configurationPath: 'tsconfig.human-gate-terminal-replay.json',
      expected: 'success',
      mutation: null,
    },
    runtime: {
      entryPath: 'out/examples/human-gate-terminal-replay.js',
      expected: 'success',
      emittedFrom: 'human-gate-terminal-replay',
    },
    documentation: {
      documentPath: 'docs/examples/human-gate-terminal-replay.md',
      publicValues: ['compilePipeline', 'reducePipeline'],
      nodeKinds: ['humanGate', 'terminal'],
    },
  },
  {
    id: 'decision-growth',
    type: {
      sourcePath: 'decision-growth.ts',
      configurationPath: 'tsconfig.decision-growth.json',
      expected: 'diagnostic:TS2345',
      mutation: 'decision-growth',
    },
    runtime: null,
    documentation: null,
  },
  {
    id: 'reduction-growth',
    type: {
      sourcePath: 'reduction-growth.ts',
      configurationPath: 'tsconfig.reduction-growth.json',
      expected: 'diagnostic:TS2345',
      mutation: 'reduction-growth',
    },
    runtime: null,
    documentation: null,
  },
  ...(['read', 'write', 'child', 'worker'] as const).map(
    (permission): ConsumerCase => ({
      id: `permission-${permission}`,
      type: null,
      runtime: {
        entryPath: `permission-${permission}.mjs`,
        expected: 'success' as const,
        emittedFrom: null,
      },
      documentation: null,
    }),
  ),
];

export const PACKAGE_CONSUMER_CASES: readonly ConsumerCase[] = Object.freeze(CASES.map(freezeCase));

export type ConsumerCompletionFault = Readonly<{
  code: 'PACKAGE_CONSUMER_LIFECYCLE';
  message: string;
}>;

export interface ConsumerAuthorization {
  readonly caseId: ConsumerCaseId;
  readonly phase: ConsumerPhase;
  readonly revision: number;
  readonly key: string;
}

export type ConsumerCompletionState =
  | Readonly<{
      kind: 'active';
      revision: number;
      completed: readonly string[];
      authorizations: readonly ConsumerAuthorization[];
    }>
  | Readonly<{ kind: 'poisoned'; revision: number; fault: ConsumerCompletionFault }>
  | Readonly<{ kind: 'complete'; revision: number; completed: readonly string[] }>;

type CompletionResult<T> =
  | Readonly<{ ok: true; state: ConsumerCompletionState; value: T }>
  | Readonly<{ ok: false; state: ConsumerCompletionState; fault: ConsumerCompletionFault }>;

const fault = (message: string): ConsumerCompletionFault =>
  Object.freeze({ code: 'PACKAGE_CONSUMER_LIFECYCLE', message });

const poison = (
  state: ConsumerCompletionState,
  message: string,
): Extract<ConsumerCompletionState, { kind: 'poisoned' }> =>
  state.kind === 'poisoned'
    ? state
    : Object.freeze({ kind: 'poisoned', revision: state.revision, fault: fault(message) });

const denied = <T>(state: ConsumerCompletionState, message: string): CompletionResult<T> => {
  const poisoned = poison(state, message);
  return Object.freeze({ ok: false, state: poisoned, fault: poisoned.fault });
};

export const initialConsumerCompletionState = (): ConsumerCompletionState =>
  Object.freeze({
    kind: 'active',
    revision: 0,
    completed: Object.freeze([]),
    authorizations: Object.freeze([]),
  });

export const consumerCase = (id: ConsumerCaseId): ConsumerCase | undefined =>
  PACKAGE_CONSUMER_CASES.find((entry) => entry.id === id);

export const consumerTypeCase = (
  id: ConsumerCaseId,
): Extract<ConsumerCase['type'], object> | undefined => consumerCase(id)?.type ?? undefined;

export const consumerRuntimeCase = (
  id: ConsumerCaseId,
): Extract<ConsumerCase['runtime'], object> | undefined => consumerCase(id)?.runtime ?? undefined;

export const consumerExpectedDiagnostic = (expected: ConsumerExpectedMode): string | undefined =>
  expected === 'success' ? undefined : expected.slice('diagnostic:'.length);

const isConsumerPhase = (phase: unknown): phase is ConsumerPhase =>
  phase === 'createType' ||
  phase === 'typeScript' ||
  phase === 'createRuntime' ||
  phase === 'executeRuntime';

const phaseExists = (entry: ConsumerCase, phase: ConsumerPhase): boolean =>
  phase === 'createType' || phase === 'typeScript' ? entry.type !== null : entry.runtime !== null;

export const authorizeConsumerEvent = (
  state: ConsumerCompletionState,
  caseId: ConsumerCaseId,
  phase: unknown,
): CompletionResult<ConsumerAuthorization> => {
  if (state.kind !== 'active') {
    return denied(state, '[package-consumer-poisoned]');
  }
  if (!isConsumerPhase(phase)) {
    return denied(state, '[package-consumer-denied] invalid-phase');
  }
  const entry = consumerCase(caseId);
  const key = `${caseId}:${phase}`;
  const prerequisite =
    phase === 'typeScript'
      ? `${caseId}:createType`
      : phase === 'executeRuntime'
        ? `${caseId}:createRuntime`
        : null;
  if (
    !entry ||
    !phaseExists(entry, phase) ||
    state.completed.includes(key) ||
    state.authorizations.some((authorization) => authorization.key === key) ||
    (prerequisite !== null && !state.completed.includes(prerequisite)) ||
    (phase === 'executeRuntime' &&
      entry.runtime?.emittedFrom !== null &&
      !state.completed.includes(`${entry.runtime?.emittedFrom}:typeScript`))
  ) {
    return denied(state, `[package-consumer-denied] ${key}`);
  }
  const authorization = Object.freeze({ caseId, phase, revision: state.revision, key });
  return Object.freeze({
    ok: true,
    value: authorization,
    state: Object.freeze({
      ...state,
      authorizations: Object.freeze([...state.authorizations, authorization]),
    }),
  });
};

export const commitConsumerEvent = (
  state: ConsumerCompletionState,
  authorization: ConsumerAuthorization,
): CompletionResult<null> => {
  if (
    state.kind !== 'active' ||
    authorization.revision !== state.revision ||
    !state.authorizations.includes(authorization) ||
    state.completed.includes(authorization.key)
  ) {
    return denied(state, '[package-consumer-commit-denied]');
  }
  return Object.freeze({
    ok: true,
    value: null,
    state: Object.freeze({
      kind: 'active',
      revision: state.revision + 1,
      completed: Object.freeze([...state.completed, authorization.key].sort()),
      authorizations: Object.freeze(
        state.authorizations.filter((candidate) => candidate !== authorization),
      ),
    }),
  });
};

export const poisonConsumerCompletion = (
  state: ConsumerCompletionState,
  message: string,
): ConsumerCompletionState => poison(state, message);

export const assertConsumerComplete = (state: ConsumerCompletionState): CompletionResult<null> => {
  if (state.kind !== 'active') {
    return denied(state, '[package-consumer-poisoned]');
  }
  const expected = PACKAGE_CONSUMER_CASES.flatMap((entry) => [
    ...(entry.type ? [`${entry.id}:createType`, `${entry.id}:typeScript`] : []),
    ...(entry.runtime ? [`${entry.id}:createRuntime`, `${entry.id}:executeRuntime`] : []),
  ]).sort();
  if (
    state.authorizations.length !== 0 ||
    JSON.stringify([...state.completed].sort()) !== JSON.stringify(expected)
  ) {
    return denied(state, '[package-consumer-incomplete]');
  }
  return Object.freeze({
    ok: true,
    value: null,
    state: Object.freeze({
      kind: 'complete',
      revision: state.revision,
      completed: Object.freeze([...state.completed]),
    }),
  });
};
