import type { DefinitionFault, DefinitionFaultCode, PipelineCompilation } from '../errors/index.js';
import { compareUnicodeCodePoints, DEFINITION_FAULT_PHASES, orderFaults } from '../policy/index.js';
import type { PipelineDefinition } from '../spec/index.js';
import { assembleCompiledPipeline } from './compilation/assemble-compiled-pipeline.js';
import { classifyForkRegions } from './compilation/classify-fork-regions.js';
import { normalizePipelineNode } from './compilation/normalize-pipeline-node.js';
import { preflightForkRegions } from './compilation/preflight-fork-regions.js';
import { projectPipelineEdges } from './compilation/project-pipeline-edges.js';
import { validateDefinitionGraph } from './compilation/validate-definition-graph.js';
import { validateDefinition } from './validation/validate-definition.js';

type MutableFault = { code: DefinitionFaultCode; path: string; message: string };

const isDefinitionFaultCode = (value: string): value is DefinitionFaultCode =>
  DEFINITION_FAULT_PHASES.some((phase) => (phase.codes as readonly string[]).includes(value));

const orderedFaults = (faults: readonly MutableFault[]): readonly DefinitionFault[] =>
  orderFaults(faults, DEFINITION_FAULT_PHASES, 'DEF_LIMIT', 'definition').map((fault) => {
    if (!isDefinitionFaultCode(fault.code)) {
      throw new Error('Unknown definition fault code.');
    }
    return Object.freeze({ code: fault.code, path: fault.path, message: fault.message });
  });

export const compilePipeline = (definition: PipelineDefinition): PipelineCompilation => {
  const validation = validateDefinition(definition);
  if (!validation.canCompile) {
    return { ok: false, faults: orderedFaults(validation.faults) };
  }
  const { entry, facts, faults, nodes, sourceIndexes, sourceNodes } = validation;
  const copiedNodes = nodes
    .map(normalizePipelineNode)
    .sort((left, right) => compareUnicodeCodePoints(left.key, right.key));
  const projectedGraph = projectPipelineEdges(copiedNodes);
  const nodeKeys = copiedNodes.map((node) => node.key);
  const preflight = preflightForkRegions(copiedNodes, nodeKeys, sourceIndexes, sourceNodes, faults);
  const graph = validateDefinitionGraph({
    edges: projectedGraph.edges,
    entry,
    faults,
    nodes: copiedNodes,
    preflight,
    sourceIndexes,
  });
  if (graph === null) {
    return { ok: false, faults: orderedFaults(faults) };
  }
  const classifiedRegions = classifyForkRegions({
    faults,
    graph,
    nodes: copiedNodes,
    preflight,
    sourceIndexes,
  });
  if (faults.length > 0) {
    return { ok: false, faults: orderedFaults(faults) };
  }
  return assembleCompiledPipeline({
    entry,
    facts,
    graph,
    nodes: copiedNodes,
    regions: classifiedRegions,
  });
};
