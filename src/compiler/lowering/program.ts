import type { ValidatedProfileMaterialization } from '../../materialization/index.js';
import type { PipelineProgram, ProgramModule } from '../../program/index.js';
import type { ValidatedPipelineSource } from '../../source/index.js';
import { indexAgentSelections } from '../dataflow/agent-selections.js';
import type { RequirementUse } from './contracts.js';
import { nonEmpty } from './non-empty.js';
import { lowerRegion } from './region.js';

export type LoweredProgram = {
  readonly program: PipelineProgram;
  readonly nodeProvenance: readonly ReturnType<typeof lowerRegion>['provenance'][number][];
  readonly requirementUses: readonly RequirementUse[];
};

export const lowerProgram = (
  source: ValidatedPipelineSource,
  materialization: ValidatedProfileMaterialization,
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
    nodeProvenance: Object.freeze(loweredModules.flatMap(({ lowered }) => lowered.provenance)),
    requirementUses: Object.freeze(loweredModules.flatMap(({ lowered }) => lowered.requirements)),
  });
};
