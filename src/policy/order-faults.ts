import { compareUnicodeCodePoints } from './compare-unicode-code-points.js';
import { PIPELINE_LIMITS } from './pipeline-limits.js';

type Fault = { readonly code: string; readonly path: string; readonly message: string };
type FaultPhase = { readonly codes: readonly string[] };

const boundedPrefix = (value: string, maximum: number): string =>
  Array.from(value).slice(0, maximum).join('');

export const orderFaults = (
  faults: readonly Fault[],
  phases: readonly FaultPhase[],
  truncationCode: string,
  comparator: 'definition' | 'decision',
): readonly Fault[] => {
  const ranks = new Map<string, readonly [number, number]>();
  phases.forEach((phase, phaseIndex) => {
    phase.codes.forEach((code, codeIndex) => ranks.set(code, [phaseIndex, codeIndex]));
  });

  const inspected = faults.map((fault) =>
    Object.freeze({
      ...fault,
      path: boundedPrefix(fault.path, PIPELINE_LIMITS.portable.pathCharacters),
      message: boundedPrefix(fault.message, PIPELINE_LIMITS.portable.messageCharacters),
    }),
  );
  const truncated = faults.length > PIPELINE_LIMITS.faults;
  inspected.sort((left, right) => {
    const leftRank = ranks.get(left.code) ?? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    const rightRank = ranks.get(right.code) ?? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    if (comparator === 'decision') {
      return (
        leftRank[0] - rightRank[0] ||
        leftRank[1] - rightRank[1] ||
        compareUnicodeCodePoints(left.path, right.path) ||
        compareUnicodeCodePoints(left.code, right.code)
      );
    }
    return (
      leftRank[0] - rightRank[0] ||
      compareUnicodeCodePoints(left.path, right.path) ||
      compareUnicodeCodePoints(left.code, right.code)
    );
  });

  if (!truncated) {
    return Object.freeze(inspected);
  }
  const retained = inspected.slice(0, PIPELINE_LIMITS.faults - 1);
  retained.push(
    Object.freeze({
      code: truncationCode,
      path: '',
      message: 'Fault limit exceeded.',
    }),
  );
  return Object.freeze(retained);
};
