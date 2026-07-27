export const snapshotSourceIndexes = (
  values: readonly unknown[],
  nodes: readonly unknown[],
  candidateVerdicts: readonly unknown[],
  gateResolutions: readonly unknown[],
) => ({
  values: values.map((_, index) => index),
  nodes: nodes.map((_, index) => index),
  candidateVerdicts: candidateVerdicts.map((_, index) => index),
  gateResolutions: gateResolutions.map((_, index) => index),
});
