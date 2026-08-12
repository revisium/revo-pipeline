import {
  EmptyObjectSchema,
  PipelineFailureValueSchema,
  canonicalizeOwnedValue,
  compareUnicodeCodePoints,
  type ValueSchema,
} from '../foundation/index.js';

export const VoteValueSchema = Object.freeze({
  type: 'string',
  enum: Object.freeze(['abstain', 'approve', 'reject']),
}) satisfies ValueSchema;

export const VoteExitSchema = Object.freeze({
  type: 'object',
  properties: Object.freeze({ vote: VoteValueSchema }),
  required: Object.freeze(['vote']),
  additionalProperties: false,
}) satisfies ValueSchema;

const consensusParticipantAlternatives: [ValueSchema, ValueSchema, ...ValueSchema[]] = [
  VoteExitSchema,
  PipelineFailureValueSchema,
  EmptyObjectSchema,
];

export const ConsensusParticipantRegionOutputSchema = Object.freeze({
  anyOf: Object.freeze(consensusParticipantAlternatives),
}) satisfies ValueSchema;

const stringEnum = (...values: readonly string[]): ValueSchema =>
  Object.freeze({
    type: 'string',
    enum: Object.freeze([...new Set(values)].sort(compareUnicodeCodePoints)),
  });

const closedObject = (properties: Readonly<Record<string, ValueSchema>>): ValueSchema => {
  const entries = Object.entries(properties).sort(([left], [right]) =>
    compareUnicodeCodePoints(left, right),
  );
  return Object.freeze({
    type: 'object',
    properties: Object.freeze(Object.fromEntries(entries)),
    required: Object.freeze(entries.map(([key]) => key)),
    additionalProperties: false,
  });
};

const union = (schemas: readonly ValueSchema[]): ValueSchema => {
  const unique = new Map(schemas.map((schema) => [canonicalizeOwnedValue(schema).text, schema]));
  const [first, second, ...rest] = [...unique.values()];
  if (first === undefined) {
    return EmptyObjectSchema;
  }
  if (second === undefined) {
    return first;
  }
  const anyOf: [ValueSchema, ValueSchema, ...ValueSchema[]] = [first, second, ...rest];
  return Object.freeze({ anyOf: Object.freeze(anyOf) });
};

export type GenericBranchSchema = {
  readonly key: string;
  readonly completed: readonly { readonly outcome: string; readonly outputSchema: ValueSchema }[];
};

export const genericParallelOutputSchema = (
  branches: readonly GenericBranchSchema[],
): ValueSchema => {
  const branchProperties: Record<string, ValueSchema> = {};
  for (const branch of branches) {
    branchProperties[branch.key] = union([
      ...branch.completed.map(({ outcome, outputSchema }) =>
        closedObject({
          status: stringEnum('completed'),
          outcome: stringEnum(outcome),
          output: outputSchema,
        }),
      ),
      closedObject({ status: stringEnum('failed'), failure: PipelineFailureValueSchema }),
      closedObject({ status: stringEnum('cancelled') }),
    ]);
  }
  return closedObject({
    classification: stringEnum('completed', 'impossible', 'failed', 'cancelled'),
    branches: closedObject(branchProperties),
  });
};

export const voteParallelOutputSchema = (participantKeys: readonly string[]): ValueSchema => {
  const result = union([
    closedObject({ status: stringEnum('vote'), vote: VoteValueSchema }),
    closedObject({ status: stringEnum('failed'), failure: PipelineFailureValueSchema }),
    closedObject({ status: stringEnum('cancelled') }),
  ]);
  return closedObject({
    classification: stringEnum(
      'approved',
      'rejected',
      'inconclusive',
      'participantFailed',
      'cancelled',
    ),
    votes: closedObject(Object.fromEntries(participantKeys.map((key) => [key, result]))),
  });
};

export const humanGateOutputSchema = (answers: readonly string[]): ValueSchema =>
  union([
    closedObject({
      kind: stringEnum('answer'),
      answer: stringEnum(...answers),
      actorRef: Object.freeze({ type: 'string' }),
    }),
    closedObject({ kind: stringEnum('conflict') }),
    closedObject({ kind: stringEnum('deadline') }),
  ]);
