import { computeRedactedDigest, type Digest } from '../foundation/index.js';
import type { ProfileMaterialization } from './contracts.js';
import { normalizeProfileMaterialization } from './validate.js';

export const defineProfileMaterialization = <const Value extends ProfileMaterialization>(
  value: Value,
): Value => value;

export const computeMaterializationDigest = (value: ProfileMaterialization): Digest =>
  computeRedactedDigest(() => {
    const result = normalizeProfileMaterialization(value);
    return result.ok ? result.value.materializationDigest : null;
  });
