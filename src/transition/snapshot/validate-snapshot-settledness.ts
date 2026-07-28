import type { PipelineDecision } from '../../errors/index.js';
import type { DecisionContext } from '../context/decision-context.js';
import { decideValidated } from '../decide-validated.js';
import { validateFactCausality } from '../evaluation/validate-fact-causality.js';
import { DecisionFaultCollector } from '../facts/decision-fault-collector.js';
import { validatePipelineFacts } from '../facts/validate-pipeline-facts.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';
import { mergeSnapshotFactFaults } from './merge-snapshot-fact-faults.js';
import { projectSnapshotFacts } from './project-snapshot-facts.js';
import { projectSnapshotSourceIndexes } from './project-snapshot-source-indexes.js';
import type { SnapshotInspection } from './snapshot-inspection.js';
import { validateSnapshotPhase } from './validate-snapshot-phase.js';
import { validateTerminalHistory } from './validate-terminal-history.js';

export const validateSnapshotSettledness = (
  inspection: SnapshotInspection,
  context: DecisionContext,
  faults: ReductionDiagnosticCollector,
): { readonly facts: ValidatedFacts; readonly decision: PipelineDecision } | undefined => {
  const projected = projectSnapshotFacts(inspection);
  const sourceIndexes = projectSnapshotSourceIndexes(inspection);
  const factFaults = new DecisionFaultCollector();
  const facts = validatePipelineFacts(projected, context, factFaults);
  if (facts && inspection.snapshot.phase !== 'terminal') {
    validateFactCausality(facts, context, factFaults);
  }
  if (factFaults.hasFaults || !facts) {
    const rejected = factFaults.reject();
    if (rejected.kind === 'reject') {
      mergeSnapshotFactFaults(rejected.faults, sourceIndexes, faults);
    }
    return undefined;
  }
  const decision = decideValidated(facts, context);
  if (!validateTerminalHistory(inspection, context)) {
    faults.add('SNAPSHOT_CAUSAL', '/snapshot/nodes', 'Terminal retirement history is invalid.');
    return undefined;
  }
  if (!validateSnapshotPhase(inspection.snapshot, decision, faults)) {
    return undefined;
  }
  return { facts, decision };
};
