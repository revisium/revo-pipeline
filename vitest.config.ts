import { defineConfig } from 'vitest/config';

import {
  NON_SCRIPT_UNIT_EXCLUDES,
  NON_SCRIPT_UNIT_TESTS,
} from './scripts/test/test-suite-routes.js';

export default defineConfig({
  test: {
    environment: 'node',
    include: [...NON_SCRIPT_UNIT_TESTS],
    exclude: [...NON_SCRIPT_UNIT_EXCLUDES],
  },
});
