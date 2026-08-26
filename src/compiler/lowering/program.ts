import type { ValidatedPipelineSelections } from '../../materialization/index.js';
import type { PipelineProgram, ProgramModule } from '../../program/index.js';
import type { SourceRegion, ValidatedPipelineSource } from '../../source/index.js';
import { indexAgentSelections } from '../dataflow/agent-selections.js';
import type { RequirementUse } from './contracts.js';
import { nonEmpty } from './non-empty.js';
import { lowerRegion } from './region.js';

const sourceNodeIdsByPath = (
  source: ValidatedPipelineSource,
): ReadonlyMap<string, string | null> => {
  const ids = new Map<string, string | null>();
  const visitRegion = (region: SourceRegion, path: string, ownerId: string | null): void => {
    ids.set(path, ownerId);
    for (const [index, node] of region.nodes.entries()) {
      const nodePath = `${path}/nodes/${index}`;
      ids.set(nodePath, node.id);
      if (node.kind === 'parallel') {
        for (const [branchIndex, branch] of node.branches.entries()) {
          visitRegion(branch.region, `${nodePath}/branches/${branchIndex}/region`, node.id);
        }
      } else if (node.kind === 'repeat' || node.kind === 'map') {
        visitRegion(node.body, `${nodePath}/body`, node.id);
      }
    }
  };
  for (const [index, module] of source.source.modules.entries()) {
    visitRegion(module.region, `/modules/${index}/region`, null);
  }
  return ids;
};

export type LoweredProgram = {
  readonly program: PipelineProgram;
  readonly nodeProvenance: readonly ReturnType<typeof lowerRegion>['provenance'][number][];
  readonly requirementUses: readonly RequirementUse[];
};

export const lowerProgram = (
  source: ValidatedPipelineSource,
  materialization: ValidatedPipelineSelections,
): LoweredProgram => {
  const context = Object.freeze({
    agentSelections: indexAgentSelections(materialization),
  });
  const loweredModules = source.source.modules.map((module, index) => {
    const lowered = lowerRegion(module.region, `/modules/${index}/region`, context);
    const programModule: ProgramModule = Object.freeze({
      key: module.key,
      inputSchema: module.inputSchema,
      outputSchema: module.outputSchema,
      region: lowered.region,
    });
    return Object.freeze({ programModule, lowered });
  });
  const sourceIds = sourceNodeIdsByPath(source);
  return Object.freeze({
    program: Object.freeze({
      schemaVersion: 'pipeline-program/v1',
      key: source.source.key,
      sourceDigest: source.sourceDigest,
      materializationDigest: materialization.materializationDigest,
      entryModule: source.source.entryModule,
      maximumTotalActivities: source.source.maximumTotalActivities,
      modules: nonEmpty(
        loweredModules.map(({ programModule }) => programModule),
        'Expected a validated non-empty module list.',
      ),
    }),
    nodeProvenance: Object.freeze(
      loweredModules.flatMap(({ lowered }) =>
        lowered.provenance.map((provenance) =>
          Object.freeze({
            ...provenance,
            sourceNodeId: sourceIds.get(provenance.sourcePath) ?? null,
          }),
        ),
      ),
    ),
    requirementUses: Object.freeze(loweredModules.flatMap(({ lowered }) => lowered.requirements)),
  });
};
