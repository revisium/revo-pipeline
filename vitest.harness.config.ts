import { defineConfig } from 'vitest/config';

import { HARNESS_TESTS } from './scripts/test/test-suite-routes.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: [...HARNESS_TESTS],
  },
});
