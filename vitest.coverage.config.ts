import { defineConfig } from 'vitest/config';

import { COVERAGE_TESTS, NON_SCRIPT_UNIT_EXCLUDES } from './scripts/test/test-suite-routes.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: [...COVERAGE_TESTS],
    exclude: [...NON_SCRIPT_UNIT_EXCLUDES],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
