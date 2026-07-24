export const DECISION_FAULT_PHASES = Object.freeze([
  Object.freeze({
    phase: 'compiled-integrity',
    codes: Object.freeze(['PIPELINE_INVALID'] as const),
  }),
  Object.freeze({ phase: 'fact-shape', codes: Object.freeze(['FACT_TYPE'] as const) }),
  Object.freeze({ phase: 'limits', codes: Object.freeze(['FACT_LIMIT'] as const) }),
  Object.freeze({ phase: 'duplicate', codes: Object.freeze(['FACT_DUPLICATE'] as const) }),
  Object.freeze({ phase: 'foreign', codes: Object.freeze(['FACT_FOREIGN'] as const) }),
  Object.freeze({ phase: 'outcome', codes: Object.freeze(['FACT_OUTCOME'] as const) }),
  Object.freeze({ phase: 'candidate', codes: Object.freeze(['FACT_CANDIDATE'] as const) }),
  Object.freeze({ phase: 'resolution', codes: Object.freeze(['FACT_RESOLUTION'] as const) }),
  Object.freeze({ phase: 'prerequisite', codes: Object.freeze(['FACT_PREMATURE'] as const) }),
  Object.freeze({ phase: 'causal', codes: Object.freeze(['FACT_CAUSAL'] as const) }),
] as const);
