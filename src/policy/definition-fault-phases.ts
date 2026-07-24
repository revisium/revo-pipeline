export const DEFINITION_FAULT_PHASES = Object.freeze([
  Object.freeze({
    phase: 'shape',
    codes: Object.freeze(['DEF_TYPE', 'DEF_UNKNOWN_FIELD', 'DEF_SCHEMA'] as const),
  }),
  Object.freeze({ phase: 'limits', codes: Object.freeze(['DEF_LIMIT'] as const) }),
  Object.freeze({
    phase: 'local-node',
    codes: Object.freeze([
      'DEF_KEY',
      'DEF_DUPLICATE',
      'DEF_BRANCH_AMBIGUOUS',
      'DEF_BRANCH_NON_EXHAUSTIVE',
      'DEF_BRANCH_UNREACHABLE_DEFAULT',
      'DEF_FORK_ARITY',
      'DEF_JOIN_THRESHOLD',
      'DEF_CONSENSUS_CANDIDATE',
      'DEF_CONSENSUS_BOUND',
      'DEF_GATE_RESOLUTION',
    ] as const),
  }),
  Object.freeze({
    phase: 'references',
    codes: Object.freeze(['DEF_ENTRY', 'DEF_TARGET', 'DEF_EDGE'] as const),
  }),
  Object.freeze({
    phase: 'regions',
    codes: Object.freeze(['DEF_FORK_JOIN', 'DEF_FORK_REGION', 'DEF_FORK_NESTED'] as const),
  }),
  Object.freeze({
    phase: 'dag',
    codes: Object.freeze(['DEF_UNREACHABLE', 'DEF_DEAD_END', 'DEF_CYCLE'] as const),
  }),
] as const);
