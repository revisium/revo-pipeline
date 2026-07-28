import { defineConfig } from 'vitest/config';

import { PACKAGE_TESTS } from './scripts/test/test-suite-routes.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: [...PACKAGE_TESTS],
  },
});
