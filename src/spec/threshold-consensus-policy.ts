export type ThresholdConsensusPolicy = {
  readonly kind: 'threshold';
  readonly approve: number;
  readonly reject: number;
};
