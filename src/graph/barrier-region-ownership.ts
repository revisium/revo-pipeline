export type BarrierRegionOwnership = {
  readonly membersByBranch: readonly (readonly number[])[];
  readonly overlappingNodeOffsets: readonly number[];
  readonly foreignRegionNodeOffsets: readonly number[];
};
