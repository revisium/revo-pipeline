import type { PipelineFacts } from '../../spec/index.js';
import type { WorkingPipelineState } from './working-pipeline-state.js';

export const projectWorkingFacts = (state: WorkingPipelineState): PipelineFacts => {
  const retired = new Set(
    state.nodes.flatMap((node) => (node.state === 'retired' ? [node.occurrence.nodeKey] : [])),
  );
  const nodes: Array<PipelineFacts['nodes'][number]> = [];
  state.nodes.forEach((node) => {
    if (node.state === 'terminal') {
      nodes.push({ key: node.occurrence.nodeKey, state: 'terminal', outcome: node.outcome });
    } else if (node.state === 'enabled') {
      nodes.push({ key: node.occurrence.nodeKey, state: 'enabled' });
    }
  });
  const candidateVerdicts: PipelineFacts['candidateVerdicts'] = state.candidateVerdicts.flatMap(
    (record) =>
      retired.has(record.occurrence.nodeKey)
        ? []
        : [
            {
              nodeKey: record.occurrence.nodeKey,
              candidate: record.candidate,
              verdict: record.verdict,
            },
          ],
  );
  const gateResolutions: PipelineFacts['gateResolutions'] = state.gateResolutions.flatMap(
    (record) =>
      retired.has(record.occurrence.nodeKey)
        ? []
        : [
            {
              nodeKey: record.occurrence.nodeKey,
              resolution: record.resolution,
            },
          ],
  );
  return {
    values: state.values.map((record) => record.fact),
    nodes,
    candidateVerdicts,
    gateResolutions,
  };
};
