import type { PipelineReduction } from '../errors/index.js';
import type { CompiledPipeline, PipelineCommand, PipelineSnapshot } from '../spec/index.js';
import { applyPipelineCommand } from './command/apply-pipeline-command.js';
import { classifyCommandReplay } from './command/classify-command-replay.js';
import { inspectPipelineCommand } from './command/inspect-pipeline-command.js';
import { buildDecisionContext } from './context/build-decision-context.js';
import { inspectCompiledPipeline } from './inspect-compiled-pipeline.js';
import { assemblePipelineReduction } from './reduction/assemble-pipeline-reduction.js';
import { canonicalizeWorkingState } from './reduction/canonicalize-working-state.js';
import { createWorkingPipelineState } from './reduction/create-working-pipeline-state.js';
import { drainPipeline } from './reduction/drain-pipeline.js';
import { ReductionDiagnosticCollector } from './reduction/reduction-diagnostic-collector.js';
import { canonicalizePipelineSnapshot } from './snapshot/canonicalize-pipeline-snapshot.js';
import { inspectPipelineSnapshot } from './snapshot/inspect-pipeline-snapshot.js';
import { validateSnapshotProvenance } from './snapshot/validate-snapshot-provenance.js';
import { validateSnapshotSettledness } from './snapshot/validate-snapshot-settledness.js';

export const reducePipeline = (
  pipelineInput: CompiledPipeline,
  snapshotInput: PipelineSnapshot,
  commandInput: PipelineCommand,
): PipelineReduction => {
  const faults = new ReductionDiagnosticCollector();
  const compiled = inspectCompiledPipeline(pipelineInput);
  if (!compiled.ok) {
    compiled.faults.forEach((fault) => {
      if (fault.code === 'DECODE_DIAGNOSTIC_LIMIT') {
        faults.add(
          'REDUCTION_DIAGNOSTIC_LIMIT',
          '/reduction/faults',
          'Pipeline reduction diagnostic limit exceeded.',
        );
      } else {
        faults.add(pipelineCode(fault.code), `/pipeline${fault.path}`, fault.message);
      }
    });
    return { ok: false, faults: faults.finish() };
  }
  const context = buildDecisionContext(compiled);
  const snapshotFaults = new ReductionDiagnosticCollector();
  const commandFaults = new ReductionDiagnosticCollector();
  const captured = inspectPipelineSnapshot(snapshotInput, context, snapshotFaults);
  const command = inspectPipelineCommand(commandInput, context, commandFaults);
  snapshotFaults.finish().forEach((fault) => faults.add(fault.code, fault.path, fault.message));
  commandFaults.finish().forEach((fault) => faults.add(fault.code, fault.path, fault.message));
  if (!captured || !command || faults.hasFaults) {
    return { ok: false, faults: faults.finish() };
  }
  validateSnapshotProvenance(captured, context, faults);
  if (faults.hasFaults) {
    return { ok: false, faults: faults.finish() };
  }
  const snapshot = canonicalizePipelineSnapshot(captured, context);
  const settled = validateSnapshotSettledness(snapshot, context, faults);
  if (!settled || faults.hasFaults) {
    return { ok: false, faults: faults.finish() };
  }
  const replay = classifyCommandReplay(command.command, snapshot.snapshot, context, faults);
  if (replay === 'invalid' || faults.hasFaults) {
    return { ok: false, faults: faults.finish() };
  }
  const state = createWorkingPipelineState(snapshot);
  if (replay === 'unchanged') {
    return assemblePipelineReduction(
      state,
      'unchanged',
      settled.decision.kind === 'wait' ? settled.decision : null,
      faults,
    );
  }
  applyPipelineCommand(command.command, state);
  const decision = drainPipeline(state, context, faults);
  if (!decision || faults.hasFaults) {
    return { ok: false, faults: faults.finish() };
  }
  canonicalizeWorkingState(state, context);
  return assemblePipelineReduction(
    state,
    'applied',
    decision.kind === 'wait' ? decision : null,
    faults,
  );
};

const pipelineCode = (code: string) => {
  if (code === 'DECODE_TYPE') {
    return 'PIPELINE_TYPE' as const;
  }
  if (code === 'DECODE_LIMIT') {
    return 'PIPELINE_LIMIT' as const;
  }
  if (code === 'DECODE_SCHEMA') {
    return 'PIPELINE_SCHEMA' as const;
  }
  if (code === 'DECODE_REFERENCE') {
    return 'PIPELINE_REFERENCE' as const;
  }
  if (code === 'DECODE_GRAPH') {
    return 'PIPELINE_GRAPH' as const;
  }
  return 'PIPELINE_CANONICAL' as const;
};
