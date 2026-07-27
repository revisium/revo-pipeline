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
  const snapshot = inspection.snapshot;
  if (!validateTerminalHistory(inspection, context)) {
    faults.add('SNAPSHOT_CAUSAL', '/snapshot/nodes', 'Terminal retirement history is invalid.');
    return undefined;
  }
  if (snapshot.phase === 'uninitialized') {
    if (
      snapshot.values.length ||
      snapshot.nodes.length ||
      snapshot.candidateVerdicts.length ||
      snapshot.gateResolutions.length ||
      snapshot.terminal !== null
    ) {
      faults.add('SNAPSHOT_PHASE', '/snapshot/phase', 'Uninitialized snapshot is not empty.');
      return undefined;
    }
  } else if (snapshot.phase === 'active' && decision.kind !== 'wait') {
    faults.add('SNAPSHOT_UNSETTLED', '/snapshot', 'Active snapshot is not settled.');
    return undefined;
  } else if (snapshot.phase === 'terminal') {
    if (snapshot.nodes.some((node) => node.state === 'enabled')) {
      faults.add(
        'SNAPSHOT_PHASE',
        '/snapshot/nodes',
        'Terminal snapshot contains an enabled node.',
      );
      return undefined;
    }
    const inconsistentRetirement = snapshot.nodes.find(
      (node) =>
        node.state === 'retired' &&
        (node.terminal.occurrence.occurrenceKey !== snapshot.terminal.occurrence.occurrenceKey ||
          node.terminal.occurrence.nodeKey !== snapshot.terminal.occurrence.nodeKey ||
          node.terminal.outcome !== snapshot.terminal.outcome),
    );
    if (inconsistentRetirement) {
      faults.add(
        'SNAPSHOT_PHASE',
        '/snapshot/nodes',
        'Retired node terminal summary is inconsistent.',
      );
      return undefined;
    }
    if (
      decision.kind !== 'terminal' ||
      snapshot.terminal.outcome !== decision.outcome ||
      snapshot.terminal.occurrence.nodeKey !== decision.nodeKey
    ) {
      faults.add(
        'SNAPSHOT_PHASE',
        '/snapshot/terminal',
        'Terminal snapshot summary is inconsistent.',
      );
      return undefined;
    }
  }
  return { facts, decision };
};
