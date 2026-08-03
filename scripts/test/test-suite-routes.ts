export const NON_SCRIPT_UNIT_TESTS = ['test/unit/**/*.test.ts'] as const;
export const NON_SCRIPT_UNIT_EXCLUDES = ['test/unit/scripts/**/*.test.ts'] as const;
export const HARNESS_TESTS = ['test/unit/scripts/**/*.test.ts'] as const;
export const PACKAGE_TESTS = ['test/package/**/*.test.ts'] as const;
export const CHARACTERIZATION_TESTS = ['test/characterization/**/*.test.ts'] as const;
export const COVERAGE_TESTS = [
  ...NON_SCRIPT_UNIT_TESTS,
  ...PACKAGE_TESTS,
  ...CHARACTERIZATION_TESTS,
] as const;

export const TEST_ROUTE_CHECKPOINT = {
  coverage: { files: 25, tests: 462 },
  harness: { files: 11, tests: 169 },
  total: { files: 36, tests: 631 },
} as const;
