import type { PipelineReduction } from '../../errors/index.js';
import type { PipelineSnapshot } from '../../spec/index.js';
import type { ReductionDiagnosticCollector } from './reduction-diagnostic-collector.js';
import { validateEffectDelta } from './validate-effect-delta.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

export const assemblePipelineReduction = (
  state: WorkingPipelineState,
  application: 'applied' | 'unchanged',
  wait: { readonly nodeKey: string; readonly reason: string } | null,
  faults: ReductionDiagnosticCollector,
): PipelineReduction => {
  if (!validateEffectDelta(state, application)) {
    faults.add('REDUCTION_INVARIANT', '/reduction/effects', 'Effect and state delta disagree.');
    return { ok: false, faults: faults.finish() };
  }
  const snapshot = snapshotOf(state);
  const batch = freeze({ kind: 'atomic' as const, items: state.effects });
  if (state.phase === 'terminal' && state.terminal) {
    return freeze({
      ok: true,
      application,
      snapshot,
      batch,
      status: 'terminal',
      wait: null,
      terminal: state.terminal,
    });
  }
  const reason = wait?.reason;
  if (
    reason !== 'task-incomplete' &&
    reason !== 'branch-fact-missing' &&
    reason !== 'consensus-incomplete' &&
    reason !== 'gate-unresolved' &&
    reason !== 'join-incomplete'
  ) {
    throw new Error('Waiting reduction requires a valid reason.');
  }
  return freeze({
    ok: true,
    application,
    snapshot,
    batch,
    status: 'waiting',
    wait: {
      occurrence: { occurrenceKey: state.occurrenceKey, nodeKey: wait?.nodeKey ?? '' },
      reason,
    },
    terminal: null,
  });
};

const freeze = <T>(value: T): T => {
  freezeValue(value);
  return value;
};

const freezeValue = (value: unknown): void => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return;
  }
  Reflect.ownKeys(value).forEach((key) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) {
      freezeValue(descriptor.value);
    }
  });
  Object.freeze(value);
};

const snapshotOf = (state: WorkingPipelineState): PipelineSnapshot => {
  const common = {
    schemaVersion: 1 as const,
    occurrenceKey: state.occurrenceKey,
    values: state.values,
    nodes: state.nodes,
    candidateVerdicts: state.candidateVerdicts,
    gateResolutions: state.gateResolutions,
  };
  if (state.phase === 'terminal' && state.terminal) {
    return freeze({ ...common, phase: 'terminal' as const, terminal: state.terminal });
  }
  if (state.phase === 'active') {
    const nodes = state.nodes.flatMap((node) => (node.state === 'retired' ? [] : [node]));
    return freeze({ ...common, phase: 'active' as const, nodes, terminal: null });
  }
  return freeze({
    schemaVersion: 1,
    occurrenceKey: state.occurrenceKey,
    phase: 'uninitialized',
    values: [],
    nodes: [],
    candidateVerdicts: [],
    gateResolutions: [],
    terminal: null,
  });
};
