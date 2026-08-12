import { Type, type Static } from 'typebox';

import { JsonPointerSchema, closedObject, readonlySchema } from '../../foundation/index.js';

export const MACHINE_FAULTS = Object.freeze({
  PROGRAM_INVALID: Object.freeze({
    family: 'PROGRAM',
    path: '/program',
    message: 'The admitted pipeline program is invalid.',
  }),
  PROGRAM_DIGEST_MISMATCH: Object.freeze({
    family: 'PROGRAM',
    path: '/programDigest',
    message: 'The program digest does not match the state pin.',
  }),
  INIT_INPUT_SCHEMA: Object.freeze({
    family: 'INIT',
    path: '/input',
    message: 'The pipeline input does not match the entry schema.',
  }),
  EVENT_SCHEMA: Object.freeze({
    family: 'EVENT',
    path: '',
    message: 'The pipeline event is invalid.',
  }),
  EVENT_FOREIGN: Object.freeze({
    family: 'EVENT',
    path: '/ref',
    message: 'The pipeline event does not reference a pending operation.',
  }),
  EVENT_CONFLICT: Object.freeze({
    family: 'EVENT',
    path: '/commandKey',
    message: 'The pipeline event conflicts with an accepted event.',
  }),
  EVENT_OPERATION_KIND: Object.freeze({
    family: 'EVENT',
    path: '/kind',
    message: 'The pipeline event kind does not match the pending operation.',
  }),
  EVENT_EXECUTOR_OUTCOME: Object.freeze({
    family: 'EVENT',
    path: '/kind',
    message: 'The executor outcome is not a pipeline event.',
  }),
  EVENT_SIGNAL: Object.freeze({
    family: 'EVENT',
    path: '/signal',
    message: 'The signal is not declared by the pending wait.',
  }),
  EVENT_GATE_ANSWER: Object.freeze({
    family: 'EVENT',
    path: '/resolution/answer',
    message: 'The answer is not declared by the pending gate.',
  }),
  DATA_POINTER_MISSING: Object.freeze({
    family: 'DATA',
    path: '',
    message: 'A required data pointer is missing.',
  }),
  DATA_SCHEMA_MISMATCH: Object.freeze({
    family: 'DATA',
    path: '',
    message: 'A runtime value does not match its declared schema.',
  }),
  INVARIANT_PROGRAM_STATE: Object.freeze({
    family: 'INVARIANT',
    path: '',
    message: 'The pipeline program and machine state are inconsistent.',
  }),
} as const);

export const MACHINE_FAULT_CODES = Object.freeze([
  'PROGRAM_INVALID',
  'PROGRAM_DIGEST_MISMATCH',
  'INIT_INPUT_SCHEMA',
  'EVENT_SCHEMA',
  'EVENT_FOREIGN',
  'EVENT_CONFLICT',
  'EVENT_OPERATION_KIND',
  'EVENT_EXECUTOR_OUTCOME',
  'EVENT_SIGNAL',
  'EVENT_GATE_ANSWER',
  'DATA_POINTER_MISSING',
  'DATA_SCHEMA_MISMATCH',
  'INVARIANT_PROGRAM_STATE',
] as const);
export type MachineFaultCode = (typeof MACHINE_FAULT_CODES)[number];

const MachineFaultCodeSchema = Type.Union([
  Type.Literal('PROGRAM_INVALID'),
  Type.Literal('PROGRAM_DIGEST_MISMATCH'),
  Type.Literal('INIT_INPUT_SCHEMA'),
  Type.Literal('EVENT_SCHEMA'),
  Type.Literal('EVENT_FOREIGN'),
  Type.Literal('EVENT_CONFLICT'),
  Type.Literal('EVENT_OPERATION_KIND'),
  Type.Literal('EVENT_EXECUTOR_OUTCOME'),
  Type.Literal('EVENT_SIGNAL'),
  Type.Literal('EVENT_GATE_ANSWER'),
  Type.Literal('DATA_POINTER_MISSING'),
  Type.Literal('DATA_SCHEMA_MISMATCH'),
  Type.Literal('INVARIANT_PROGRAM_STATE'),
]);

export const MachineFaultFamilySchema = Type.Union([
  Type.Literal('PROGRAM'),
  Type.Literal('INIT'),
  Type.Literal('EVENT'),
  Type.Literal('DATA'),
  Type.Literal('INVARIANT'),
]);
export type MachineFaultFamily = Static<typeof MachineFaultFamilySchema>;

export const MachineFaultSchema = closedObject({
  family: readonlySchema(MachineFaultFamilySchema),
  code: readonlySchema(MachineFaultCodeSchema),
  path: readonlySchema(JsonPointerSchema),
  message: readonlySchema(Type.String({ maxLength: 512 })),
});
export type MachineFault = Static<typeof MachineFaultSchema>;
