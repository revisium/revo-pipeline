import {
  canonicalizeOwnedValue,
  digestCanonicalBytes,
  type JsonPointer,
} from '../../foundation/index.js';
import type { LoweringRole, NodeProvenance, ProgramNodeId } from '../../program/index.js';

export type LoweredIdentity = {
  readonly id: ProgramNodeId;
  readonly provenance: NodeProvenance;
};

export const createLoweredIdentity = (
  sourcePath: JsonPointer,
  loweringRole: LoweringRole,
  ordinal: number,
  materializationPath: JsonPointer | null,
): LoweredIdentity => {
  const bytes = canonicalizeOwnedValue({ sourcePath, loweringRole, ordinal }).bytes;
  const id = digestCanonicalBytes('pipeline-ir-id/v1', bytes);
  return Object.freeze({
    id,
    provenance: Object.freeze({
      programNodeId: id,
      sourceNodeId: null,
      sourcePath,
      materializationPath,
      loweringRole,
      ordinal,
    }),
  });
};
