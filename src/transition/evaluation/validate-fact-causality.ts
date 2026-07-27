import type { DecisionContext } from '../context/decision-context.js';
import type { DecisionFaultCollector } from '../facts/decision-fault-collector.js';
import type { ValidatedFacts } from '../facts/validated-facts.js';
import { selectNode } from './select-node.js';

export const validateFactCausality = (
  facts: ValidatedFacts,
  context: DecisionContext,
  faults: DecisionFaultCollector,
): void => {
  const byNode = facts.nodeByKey;
  facts.candidateVerdicts.forEach(({ fact, sourceIndex }) => {
    if (!byNode.has(fact.nodeKey)) {
      faults.add(
        'FACT_PREMATURE',
        `/candidateVerdicts/${sourceIndex}`,
        'Verdict node is not activated.',
      );
    }
  });
  facts.gateResolutions.forEach(({ fact, sourceIndex }) => {
    if (!byNode.has(fact.nodeKey)) {
      faults.add(
        'FACT_PREMATURE',
        `/gateResolutions/${sourceIndex}`,
        'Gate node is not activated.',
      );
    }
  });
  validateActivations(facts, context, faults);
  validateTerminalSelectors(facts, context, faults);
};

const validateActivations = (
  facts: ValidatedFacts,
  context: DecisionContext,
  faults: DecisionFaultCollector,
): void => {
  const pipeline = context.compiled.snapshot;
  const byNode = facts.nodeByKey;
  facts.nodes.forEach(({ fact, sourceIndex }) => {
    if (fact.key === pipeline.entry) {
      return;
    }
    const activated = (context.incomingByKey.get(fact.key) ?? []).some((edgeOffset) => {
      const edge = pipeline.edges[edgeOffset];
      if (edge?.role !== 'activation') {
        return false;
      }
      const source = byNode.get(edge.from);
      return source?.state === 'terminal' && source.outcome === edge.outcome;
    });
    if (!activated) {
      faults.add('FACT_CAUSAL', `/nodes/${sourceIndex}`, 'Node fact has no activation cause.');
    }
    const owningFork = context.regionOwnerByNode.get(fact.key);
    const forkFact = owningFork ? byNode.get(owningFork) : undefined;
    if (owningFork && (forkFact?.state !== 'terminal' || forkFact.outcome !== 'forked')) {
      faults.add(
        'FACT_CAUSAL',
        `/nodes/${sourceIndex}`,
        'Fork-region fact is missing its owning fork.',
      );
    }
  });
};

const validateTerminalSelectors = (
  facts: ValidatedFacts,
  context: DecisionContext,
  faults: DecisionFaultCollector,
): void => {
  const pipeline = context.compiled.snapshot;
  const byNode = facts.nodeByKey;
  facts.nodes.forEach(({ fact, sourceIndex }) => {
    if (fact.state !== 'terminal') {
      return;
    }
    const node = context.nodeByKey.get(fact.key);
    if (!node || node.kind === 'task' || node.kind === 'terminal') {
      return;
    }
    const selection = selectNode(node, facts, context);
    if (node.kind === 'branch') {
      if (selection && selection.outcome !== fact.outcome) {
        faults.add(
          'FACT_OUTCOME',
          `/nodes/${sourceIndex}/outcome`,
          'Branch outcome contradicts fact.',
        );
        return;
      }
      const edge = (context.outgoingByKey.get(node.key) ?? [])
        .map((edgeOffset) => pipeline.edges[edgeOffset])
        .find((candidate) => candidate?.outcome === fact.outcome);
      if ((selection && edge?.to !== selection.targets[0]) || (edge && !byNode.has(edge.to))) {
        faults.add(
          'FACT_CAUSAL',
          `/nodes/${sourceIndex}`,
          'Terminal branch is missing or contradicts its atomic target.',
        );
      }
      return;
    }
    if (!selection) {
      faults.add(
        'FACT_PREMATURE',
        `/nodes/${sourceIndex}`,
        'Terminal selector has no determined outcome.',
      );
      return;
    }
    if (selection.outcome !== fact.outcome) {
      faults.add(
        'FACT_OUTCOME',
        `/nodes/${sourceIndex}/outcome`,
        'Selector outcome contradicts facts.',
      );
      return;
    }
    if (selection.targets.some((target) => !byNode.has(target))) {
      faults.add(
        'FACT_CAUSAL',
        `/nodes/${sourceIndex}`,
        'Terminal selector is missing its atomic target.',
      );
    }
  });
};
