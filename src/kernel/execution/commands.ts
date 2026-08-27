import type {
  Digest,
  JsonPointer,
  JsonValue,
  PipelineFailure,
  ValueSchema,
} from '../../foundation/index.js';
import type { PipelineCommand } from '../contracts/commands.js';
import type { CommandRef } from '../contracts/identity.js';
import { computeCommandKey } from '../identity/digests.js';

const keyFor = (kind: PipelineCommand['kind'], ref: CommandRef) => computeCommandKey(kind, ref);

export const dispatchActivityCommand = (
  ref: CommandRef,
  requirementKey: string,
  input: JsonValue,
  outputSchema: ValueSchema,
) => {
  const key = keyFor('dispatchActivity', ref);
  return key === null
    ? null
    : Object.freeze({
        kind: 'dispatchActivity' as const,
        key,
        ref,
        requirementKey,
        input,
        outputSchema,
      });
};

export const scheduleWaitCommand = (
  ref: CommandRef,
  wait:
    | { readonly kind: 'duration'; readonly durationMs: number }
    | {
        readonly kind: 'signal';
        readonly signal: string;
        readonly payloadSchema: ValueSchema | null;
      },
) => {
  const key = keyFor('scheduleWait', ref);
  return key === null ? null : Object.freeze({ kind: 'scheduleWait' as const, key, ref, wait });
};

export const openHumanGateCommand = (
  ref: CommandRef,
  subject: string,
  answers: readonly [string, ...string[]],
  authorizationRequirements: readonly string[],
  payloadSchema: ValueSchema | null,
  deadline: { readonly afterMs: number } | null,
) => {
  const key = keyFor('openHumanGate', ref);
  const ownedAnswers: readonly [string, ...string[]] = Object.freeze([
    answers[0],
    ...answers.slice(1),
  ]);
  return key === null
    ? null
    : Object.freeze({
        kind: 'openHumanGate' as const,
        key,
        ref,
        subject,
        answers: ownedAnswers,
        authorizationRequirements: Object.freeze([...authorizationRequirements]),
        payloadSchema,
        deadline,
      });
};

export const cancelPendingCommand = (
  ref: CommandRef,
  targets: readonly [Digest, ...Digest[]],
  reasonCode: string,
) => {
  const key = keyFor('cancelPending', ref);
  const ownedTargets: readonly [Digest, ...Digest[]] = Object.freeze([
    targets[0],
    ...targets.slice(1),
  ]);
  return key === null
    ? null
    : Object.freeze({
        kind: 'cancelPending' as const,
        key,
        ref,
        targets: ownedTargets,
        reasonCode,
      });
};

export const completeCommand = (ref: CommandRef, outcome: string, output: JsonValue) => {
  const key = keyFor('complete', ref);
  return key === null
    ? null
    : Object.freeze({ kind: 'complete' as const, key, ref, outcome, output });
};

export const failCommand = (ref: CommandRef, failure: PipelineFailure) => {
  const key = keyFor('fail', ref);
  return key === null
    ? null
    : Object.freeze({
        kind: 'fail' as const,
        key,
        ref,
        code: failure.code,
        path: failure.path,
      });
};

export const cancelCommand = (ref: CommandRef, reasonCode: string) => {
  const key = keyFor('cancel', ref);
  return key === null ? null : Object.freeze({ kind: 'cancel' as const, key, ref, reasonCode });
};

export const pipelineReference = (
  programDigest: CommandRef['programDigest'],
  frameKey: CommandRef['frameKey'],
): CommandRef => Object.freeze({ programDigest, frameKey, nodeId: '$pipeline' });

export const nodeReference = (
  programDigest: CommandRef['programDigest'],
  frameKey: CommandRef['frameKey'],
  nodeId: CommandRef['nodeId'],
): CommandRef => Object.freeze({ programDigest, frameKey, nodeId });

export const dataFailure = (code: string, path: JsonPointer): PipelineFailure =>
  Object.freeze({ code, path });
