import type { DecodeFault } from '../../errors/index.js';
import {
  compareUnicodeCodePoints,
  DECODE_FAULT_PHASES,
  PIPELINE_LIMITS,
} from '../../policy/index.js';
import type { CompiledInspectionFault } from './compiled-inspection-fault.js';

const SENTINEL = Object.freeze({
  code: 'DECODE_DIAGNOSTIC_LIMIT',
  path: '/faults',
  message: 'Compiled pipeline diagnostic limit exceeded.',
} as const);

export class CompiledInspectionFaultCollector {
  readonly #faults: CompiledInspectionFault[] = [];

  get hasFaults(): boolean {
    return this.#faults.length > 0;
  }

  add(fault: CompiledInspectionFault): void {
    this.#faults.push(Object.freeze(fault));
  }

  finish(): readonly DecodeFault[] {
    const ranks = new Map<string, number>();
    DECODE_FAULT_PHASES.forEach((phase, index) =>
      phase.codes.forEach((code) => ranks.set(code, index)),
    );
    const bounded = (value: string, maximum: number) =>
      Array.from(value).slice(0, maximum).join('');
    const ordered: DecodeFault[] = this.#faults.map((fault) =>
      Object.freeze({
        ...fault,
        path: bounded(fault.path, PIPELINE_LIMITS.portable.pathCharacters),
        message: bounded(fault.message, PIPELINE_LIMITS.portable.messageCharacters),
      }),
    );
    ordered.sort(
      (left, right) =>
        (ranks.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
          (ranks.get(right.code) ?? Number.MAX_SAFE_INTEGER) ||
        compareUnicodeCodePoints(left.path, right.path) ||
        compareUnicodeCodePoints(left.code, right.code) ||
        compareUnicodeCodePoints(left.message, right.message),
    );
    return Object.freeze(
      ordered.length <= PIPELINE_LIMITS.faults
        ? ordered
        : [...ordered.slice(0, PIPELINE_LIMITS.faults - 1), SENTINEL],
    );
  }
}
