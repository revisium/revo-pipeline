export type BarrierRegionQuery = {
  readonly barrierNodeOffset: number;
  readonly branches: readonly {
    readonly entryNodeOffset: number;
    readonly exitNodeOffset: number;
  }[];
};
