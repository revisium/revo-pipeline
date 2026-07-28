import { defineConfig } from 'vitest/config';

import { CHARACTERIZATION_TESTS } from './scripts/test/test-suite-routes.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: [...CHARACTERIZATION_TESTS],
  },
});
