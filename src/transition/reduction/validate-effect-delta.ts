import type {
  PipelineEffect,
  PipelineSnapshotNode,
  PipelineTerminal,
  PipelineValueRecord,
} from '../../spec/index.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

interface ShadowState {
  phase: WorkingPipelineState['phase'];
  readonly values: PipelineValueRecord[];
  readonly nodes: PipelineSnapshotNode[];
  readonly candidateVerdicts: WorkingPipelineState['candidateVerdicts'][number][];
  readonly gateResolutions: WorkingPipelineState['gateResolutions'][number][];
  terminal: PipelineTerminal | null;
}

const terminalize = (shadow: ShadowState, nodeKey: string, outcome: string): void => {
  const index = shadow.nodes.findIndex((node) => node.occurrence.nodeKey === nodeKey);
  const node = shadow.nodes[index];
  if (node) {
    shadow.nodes[index] = { occurrence: node.occurrence, state: 'terminal', outcome };
  }
};

const applyEffect = (shadow: ShadowState, effect: PipelineEffect): void => {
  if (effect.kind === 'initialize') {
    shadow.phase = 'active';
    shadow.values.push(
      ...effect.values.map((fact) => ({
        fact,
        source: { kind: 'init' as const, occurrenceKey: effect.occurrenceKey },
      })),
    );
  } else if (effect.kind === 'completeTask') {
    terminalize(shadow, effect.occurrence.nodeKey, effect.outcome);
    shadow.values.push(
      ...effect.values.map((fact) => ({
        fact,
        source: { kind: 'taskOutcome' as const, occurrence: effect.occurrence },
      })),
    );
  } else if (effect.kind === 'recordConsensusVerdict') {
    shadow.candidateVerdicts.push({
      occurrence: effect.occurrence,
      candidate: effect.candidate,
      verdict: effect.verdict,
    });
  } else if (effect.kind === 'resolveHumanGate') {
    shadow.gateResolutions.push({
      occurrence: effect.occurrence,
      resolution: effect.resolution,
    });
    shadow.values.push(
      ...effect.values.map((fact) => ({
        fact,
        source: { kind: 'humanGateResolution' as const, occurrence: effect.occurrence },
      })),
    );
  } else if (effect.kind === 'completeSelector') {
    terminalize(shadow, effect.occurrence.nodeKey, effect.outcome);
  } else if (effect.kind === 'activateNode') {
    shadow.nodes.push({ occurrence: effect.occurrence, state: 'enabled' });
  } else if (effect.kind === 'terminatePipeline') {
    closeTerminal(shadow, effect);
  }
};

const closeTerminal = (
  shadow: ShadowState,
  effect: Extract<PipelineEffect, { readonly kind: 'terminatePipeline' }>,
): void => {
  terminalize(shadow, effect.terminal.occurrence.nodeKey, effect.terminal.outcome);
  const retired = new Set(effect.retirements.map((item) => item.occurrence.nodeKey));
  shadow.nodes.splice(
    0,
    shadow.nodes.length,
    ...shadow.nodes.map((node) =>
      retired.has(node.occurrence.nodeKey)
        ? { occurrence: node.occurrence, state: 'retired' as const, terminal: effect.terminal }
        : node,
    ),
  );
  shadow.phase = 'terminal';
  shadow.terminal = effect.terminal;
};

const comparable = (state: ShadowState | WorkingPipelineState): string =>
  JSON.stringify({
    phase: state.phase,
    values: state.values,
    nodes: state.nodes,
    candidateVerdicts: state.candidateVerdicts,
    gateResolutions: state.gateResolutions,
    terminal: state.terminal,
  });

export const validateEffectDelta = (
  state: WorkingPipelineState,
  application: 'applied' | 'unchanged',
): boolean => {
  if (state.effects.length > 514 || (application === 'unchanged' && state.effects.length !== 0)) {
    return false;
  }
  const baseline = state.baseline;
  const shadow: ShadowState = {
    phase: baseline.phase,
    values: [...baseline.values],
    nodes: [...baseline.nodes],
    candidateVerdicts: [...baseline.candidateVerdicts],
    gateResolutions: [...baseline.gateResolutions],
    terminal: baseline.terminal,
  };
  state.effects.forEach((effect) => applyEffect(shadow, effect));
  alignOrder(shadow.values, state.values, (item) => item.fact.key);
  alignOrder(shadow.nodes, state.nodes, (item) => item.occurrence.nodeKey);
  alignOrder(
    shadow.candidateVerdicts,
    state.candidateVerdicts,
    (item) => `${item.occurrence.nodeKey}\u0000${item.candidate}`,
  );
  alignOrder(shadow.gateResolutions, state.gateResolutions, (item) => item.occurrence.nodeKey);
  return comparable(shadow) === comparable(state);
};

const alignOrder = <T>(values: T[], target: readonly T[], identity: (value: T) => string): void => {
  const position = new Map(target.map((value, index) => [identity(value), index]));
  values.sort(
    (left, right) => (position.get(identity(left)) ?? 999) - (position.get(identity(right)) ?? 999),
  );
};
