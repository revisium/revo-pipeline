import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Static } from 'typebox';
import { Compile } from 'typebox/compile';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  AgentActivityInputSchema,
  type AgentActivityInput,
  type ScriptPin,
} from '../../src/index.js';

const packageJson = readFileSync(
  fileURLToPath(new URL('../../package.json', import.meta.url)),
  'utf8',
);

describe('published package surface', () => {
  it('publishes only the root compiler and kernel entrypoints', () => {
    expect(packageJson).toMatch(/"exports":\s*\{\s*"\.":\s*\{[\s\S]*?\},\s*"\.\/kernel":\s*\{/u);
    expect(packageJson).not.toContain(`"./execution${String.fromCharCode(45)}plan"`);
  });

  it('exports a broad portable agent envelope with no arbitrary top-level fields', () => {
    const validator = Compile(AgentActivityInputSchema);

    expectTypeOf<Static<typeof AgentActivityInputSchema>>().toEqualTypeOf<AgentActivityInput>();
    expect(validator.Check({ prompt: 'Review', metadata: { nested: { attempt: 2 } } })).toBe(true);
    expect(validator.Check({ prompt: 'Review', request: 'forbidden' })).toBe(false);
  });

  it('keeps the public script pin structurally portable', () => {
    expectTypeOf<ScriptPin>().toEqualTypeOf<{ readonly id: string; readonly version: number }>();
  });
});
