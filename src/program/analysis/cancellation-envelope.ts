import { PROGRAM_ADMISSION_LIMITS } from './limits.js';

export type CancellationEnvelope = {
  readonly sets: number;
  readonly memberships: number;
  readonly maximumTokenDegree: number;
};

export const EMPTY_CANCELLATION_ENVELOPE: CancellationEnvelope = Object.freeze({
  sets: 0,
  memberships: 0,
  maximumTokenDegree: 0,
});

const capSets = (value: number): number => Math.min(value, PROGRAM_ADMISSION_LIMITS.liveFrames + 1);
const capMemberships = (value: number): number =>
  Math.min(value, PROGRAM_ADMISSION_LIMITS.cancellationMemberships + 1);

export const alternativeCancellation = (
  envelopes: readonly CancellationEnvelope[],
): CancellationEnvelope =>
  envelopes.length === 0
    ? EMPTY_CANCELLATION_ENVELOPE
    : Object.freeze({
        sets: Math.max(...envelopes.map(({ sets }) => sets)),
        memberships: Math.max(...envelopes.map(({ memberships }) => memberships)),
        maximumTokenDegree: Math.max(
          ...envelopes.map(({ maximumTokenDegree }) => maximumTokenDegree),
        ),
      });

export const disjointCancellation = (
  left: CancellationEnvelope,
  right: CancellationEnvelope,
): CancellationEnvelope =>
  Object.freeze({
    sets: capSets(left.sets + right.sets),
    memberships: capMemberships(left.memberships + right.memberships),
    maximumTokenDegree: Math.max(left.maximumTokenDegree, right.maximumTokenDegree),
  });

export const overlayCancellation = (
  envelope: CancellationEnvelope,
  targetCount: number,
): CancellationEnvelope => {
  if (targetCount === 0) {
    return envelope;
  }
  const sets = capSets(envelope.sets + 1);
  const memberships = capMemberships(envelope.memberships + targetCount);
  return Object.freeze({
    sets,
    memberships,
    maximumTokenDegree: Math.min(sets, memberships, envelope.maximumTokenDegree + 1),
  });
};

export const reverseIndexWork = (envelope: CancellationEnvelope): number =>
  Math.min(PROGRAM_ADMISSION_LIMITS.synchronousWork + 1, envelope.sets + envelope.memberships);

export const acknowledgementWork = (envelope: CancellationEnvelope): number =>
  Math.min(PROGRAM_ADMISSION_LIMITS.synchronousWork + 1, 1 + 2 * envelope.maximumTokenDegree);
