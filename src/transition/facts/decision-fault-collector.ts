import type { DecisionFault, DecisionFaultCode, PipelineDecision } from '../../errors/index.js';
import { DECISION_FAULT_PHASES, orderFaults } from '../../policy/index.js';

type MutableFault = { code: DecisionFaultCode; path: string; message: string };

export class DecisionFaultCollector {
  readonly #faults: MutableFault[] = [];

  get hasFaults(): boolean {
    return this.#faults.length > 0;
  }

  add(code: DecisionFaultCode, path: string, message: string): void {
    this.#faults.push({ code, path, message });
  }

  reject(): PipelineDecision {
    return { kind: 'reject', faults: this.#ordered() };
  }

  #ordered(): readonly DecisionFault[] {
    return orderFaults(this.#faults, DECISION_FAULT_PHASES, 'FACT_LIMIT', 'decision').map(
      (fault) => {
        const code = DECISION_FAULT_PHASES.flatMap((phase) => phase.codes).find(
          (candidate) => candidate === fault.code,
        );
        if (!code) {
          throw new Error(`Unexpected decision fault code: ${fault.code}`);
        }
        return { code, path: fault.path, message: fault.message };
      },
    );
  }
}
