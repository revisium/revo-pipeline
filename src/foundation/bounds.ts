export const PIPELINE_LIMITS = Object.freeze({
  identifierCodePoints: 64,
  displayStringCodePoints: 512,
  portableValue: Object.freeze({
    depth: 16,
    objectKeys: 64,
    arrayItems: 1_024,
    visitedValues: 65_536,
  }),
  sourcePackage: Object.freeze({
    modules: 64,
    nodes: 4_096,
    targets: 16_384,
    nestingDepth: 32,
    callDepth: 32,
    totalActivities: 1_000_000,
  }),
  program: Object.freeze({
    nodes: 4_096,
    regions: 4_096,
    targets: 16_384,
  }),
  structured: Object.freeze({
    participants: 32,
    repeatIterations: 100,
    mapItems: 1_024,
  }),
  machine: Object.freeze({
    synchronousStepsPerTransition: 65_536,
    liveFrames: 16_384,
    liveOperations: 16_384,
    totalNodeResults: 65_536,
    structuralCollectionSlots: 262_144,
    cancellationMemberships: 65_536,
    serializedStateJsonValues: 1_048_576,
    commandJsonValuesPerTransition: 1_048_576,
  }),
  diagnostics: 100,
} as const);

export const isSafeIntegerInRange = (value: unknown, minimum: number, maximum: number): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;

export const addWithinLimit = (left: number, right: number, limit: number): number | null => {
  if (![left, right, limit].every(Number.isSafeInteger) || left < 0 || right < 0 || limit < 0) {
    return null;
  }
  if (left > limit - right) {
    return null;
  }
  return left + right;
};

export const multiplyWithinLimit = (left: number, right: number, limit: number): number | null => {
  if (![left, right, limit].every(Number.isSafeInteger) || left < 0 || right < 0 || limit < 0) {
    return null;
  }
  if (left !== 0 && right > Math.floor(limit / left)) {
    return null;
  }
  return left * right;
};
