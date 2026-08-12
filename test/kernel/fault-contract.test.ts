import { describe, expect, it } from 'vitest';

import { MACHINE_FAULT_CODES, MACHINE_FAULTS } from '../../src/kernel/index.js';
import { createMachineFault } from '../support/kernel-internal.js';

describe('kernel fault contract', () => {
  it('pins every stable family, path, and fixed message', () => {
    expect(Object.keys(MACHINE_FAULTS)).toHaveLength(13);
    for (const code of MACHINE_FAULT_CODES) {
      expect(createMachineFault(code)).toEqual({ code, ...MACHINE_FAULTS[code] });
      expect(createMachineFault(code).message.length).toBeLessThanOrEqual(512);
    }
  });

  it('uses the attempted path only for DATA faults', () => {
    expect(createMachineFault('DATA_POINTER_MISSING', '/input/value').path).toBe('/input/value');
    expect(createMachineFault('EVENT_SCHEMA', '/ignored').path).toBe('');
  });
});
