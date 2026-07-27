import type { DecisionContext } from '../context/decision-context.js';
import { validateFactCausality } from '../evaluation/validate-fact-causality.js';
import { DecisionFaultCollector } from '../facts/decision-fault-collector.js';
import { validatePipelineFacts } from '../facts/validate-pipeline-facts.js';
import { projectSnapshotFacts } from './project-snapshot-facts.js';
import type { SnapshotInspection } from './snapshot-inspection.js';

export const validateTerminalHistory = (
  inspection: SnapshotInspection,
  context: DecisionContext,
): boolean => {
  if (inspection.snapshot.phase !== 'terminal') {
    return true;
  }
  const projected = projectSnapshotFacts(inspection);
  const retired = inspection.snapshot.nodes.flatMap((node) =>
    node.state === 'retired' ? [{ key: node.occurrence.nodeKey, state: 'enabled' as const }] : [],
  );
  const collector = new DecisionFaultCollector();
  const facts = validatePipelineFacts(
    { ...projected, nodes: [...projected.nodes, ...retired] },
    context,
    collector,
  );
  if (facts) {
    validateFactCausality(facts, context, collector);
  }
  return facts !== undefined && !collector.hasFaults;
};
