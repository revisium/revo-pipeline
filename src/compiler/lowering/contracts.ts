import type { JsonPointer } from '../../foundation/index.js';
import type {
  NodeProvenance,
  ProgramNode,
  ProgramRegion,
  ProgramRequirement,
} from '../../program/index.js';
import type { SourceRegion } from '../../source/index.js';
import type { MaterializedAgentSelection } from '../dataflow/agent-selections.js';

export type RequirementUse = {
  readonly requirement: ProgramRequirement;
  readonly sourcePath: JsonPointer;
  readonly materializationPath: JsonPointer | null;
};

export type LoweredNodeFragment = {
  readonly nodes: readonly ProgramNode[];
  readonly provenance: readonly NodeProvenance[];
  readonly requirements: readonly RequirementUse[];
};

export type LoweredRegion = {
  readonly region: ProgramRegion;
  readonly provenance: readonly NodeProvenance[];
  readonly requirements: readonly RequirementUse[];
};

export type LoweringContext = {
  readonly agentSelections: ReadonlyMap<JsonPointer, MaterializedAgentSelection>;
};

export type RegionLowerer = (
  region: SourceRegion,
  path: JsonPointer,
  context: LoweringContext,
) => LoweredRegion;
