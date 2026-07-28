import type { PipelineReductionFault, PipelineReductionFaultCode } from '../../errors/index.js';
import { compareUnicodeCodePoints } from '../../policy/index.js';

const ORDER: readonly PipelineReductionFaultCode[] = [
  'PIPELINE_TYPE',
  'PIPELINE_LIMIT',
  'PIPELINE_SCHEMA',
  'PIPELINE_REFERENCE',
  'PIPELINE_GRAPH',
  'PIPELINE_CANONICAL',
  'SNAPSHOT_TYPE',
  'SNAPSHOT_LIMIT',
  'SNAPSHOT_SCHEMA',
  'SNAPSHOT_DUPLICATE',
  'SNAPSHOT_FOREIGN',
  'SNAPSHOT_OUTCOME',
  'SNAPSHOT_CANDIDATE',
  'SNAPSHOT_RESOLUTION',
  'SNAPSHOT_PREMATURE',
  'SNAPSHOT_CAUSAL',
  'SNAPSHOT_PHASE',
  'SNAPSHOT_UNSETTLED',
  'COMMAND_TYPE',
  'COMMAND_LIMIT',
  'COMMAND_SCHEMA',
  'COMMAND_DUPLICATE',
  'COMMAND_TARGET',
  'COMMAND_OUTCOME',
  'COMMAND_CONFLICT',
  'COMMAND_STATE',
  'REDUCTION_STEP_LIMIT',
  'REDUCTION_INVARIANT',
  'REDUCTION_DIAGNOSTIC_LIMIT',
];

export class ReductionDiagnosticCollector {
  readonly #faults: PipelineReductionFault[] = [];

  get hasFaults(): boolean {
    return this.#faults.length > 0;
  }

  add(code: PipelineReductionFaultCode, path: string, message: string): void {
    this.#faults.push({ code, path, message });
  }

  finish(): readonly PipelineReductionFault[] {
    const rank = new Map(ORDER.map((code, index) => [code, index]));
    const faults = this.#faults.map((fault) =>
      Object.freeze({
        ...fault,
        path: Array.from(fault.path).slice(0, 1024).join(''),
        message: Array.from(fault.message).slice(0, 512).join(''),
      }),
    );
    faults.sort(
      (left, right) =>
        (rank.get(left.code) ?? 99) - (rank.get(right.code) ?? 99) ||
        compareUnicodeCodePoints(left.path, right.path) ||
        compareUnicodeCodePoints(left.message, right.message),
    );
    return Object.freeze(
      faults.length <= 100
        ? faults
        : [
            ...faults.slice(0, 99),
            Object.freeze({
              code: 'REDUCTION_DIAGNOSTIC_LIMIT' as const,
              path: '/reduction/faults',
              message: 'Pipeline reduction diagnostic limit exceeded.',
            }),
          ],
    );
  }
}
