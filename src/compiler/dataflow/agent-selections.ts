import type { JsonPointer } from '../../foundation/index.js';
import type {
  InternalAgentSlot,
  ValidatedPipelineSelections,
} from '../../materialization/index.js';

export type MaterializedAgentSelection = {
  readonly slot: InternalAgentSlot;
};

export const indexAgentSelections = (
  materialization: ValidatedPipelineSelections,
): ReadonlyMap<JsonPointer, MaterializedAgentSelection> =>
  new Map(
    materialization.materialization.slots.map((slot) => [
      slot.sourcePath,
      Object.freeze({
        slot,
      }),
    ]),
  );
