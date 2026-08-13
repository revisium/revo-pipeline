import type { Digest } from '../../../foundation/index.js';
import type {
  MapItemDescriptor,
  MapPreflightCounters,
  MapPreflightResult,
} from './map-preflight.js';

export type MapPreflightIndexCounters = MapPreflightCounters & {
  descriptorIndexes: number;
  descriptorLookups: number;
};

export type MapPreflightIndex = {
  readonly remember: (ownerKey: Digest, result: MapPreflightResult) => void;
  readonly descriptor: (
    ownerKey: Digest,
    itemKey: string,
    build: (counters?: MapPreflightCounters) => MapItemDescriptor | null,
  ) => MapItemDescriptor | null;
};

export const createMapPreflightIndex = (
  counters?: MapPreflightIndexCounters,
): MapPreflightIndex => {
  const entries = new Map<Digest, Map<string, MapItemDescriptor>>();
  const remember = (ownerKey: Digest, result: MapPreflightResult): void => {
    const descriptors = new Map<string, MapItemDescriptor>();
    if (result.ok) {
      for (const descriptor of result.descriptors) {
        descriptors.set(descriptor.itemKey, descriptor);
      }
      if (counters !== undefined) {
        counters.descriptorIndexes += result.descriptors.length;
      }
    }
    entries.set(ownerKey, descriptors);
  };
  return Object.freeze({
    remember,
    descriptor: (ownerKey, itemKey, build) => {
      let descriptors = entries.get(ownerKey);
      if (descriptors === undefined) {
        descriptors = new Map();
        entries.set(ownerKey, descriptors);
      }
      if (counters !== undefined) {
        counters.descriptorLookups += 1;
      }
      const existing = descriptors.get(itemKey);
      if (existing !== undefined) {
        return existing;
      }
      const descriptor = build(counters);
      if (descriptor !== null) {
        descriptors.set(itemKey, descriptor);
        if (counters !== undefined) {
          counters.descriptorIndexes += 1;
        }
      }
      return descriptor;
    },
  });
};
