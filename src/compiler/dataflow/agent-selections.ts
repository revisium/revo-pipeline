import type { JsonPointer } from '../../foundation/index.js';
import type {
  AgentSlotMaterialization,
  ValidatedProfileMaterialization,
} from '../../materialization/index.js';

export type MaterializedAgentSelection = {
  readonly slot: AgentSlotMaterialization;
  readonly slotIndex: number;
};

export const indexAgentSelections = (
  materialization: ValidatedProfileMaterialization,
): ReadonlyMap<JsonPointer, MaterializedAgentSelection> =>
  new Map(
    materialization.materialization.slots.map((slot, slotIndex) => [
      slot.sourcePath,
      Object.freeze({ slot, slotIndex }),
    ]),
  );
