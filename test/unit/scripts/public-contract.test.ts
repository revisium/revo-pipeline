import { expect, test } from 'vitest';

import {
  assertExactPublicDeclaration,
  assertTypeOnlyRuntimeModule,
  publicDeclarationFingerprint,
} from '../../../scripts/package/public-contract.js';

const accepted = "export { value } from './value.js';\nexport type { Shape } from './shape.js';\n";
const acceptedFingerprint = publicDeclarationFingerprint(accepted);

test.each([
  ['addition', `${accepted}export type { Added } from './added.js';\n`],
  ['removal', "export { value } from './value.js';\n"],
  ['alias', accepted.replace('value }', 'value as alias }')],
  ['type/value phase', accepted.replace('export type { Shape }', 'export { Shape }')],
])('rejects public declaration %s mutations', (_name, mutation) => {
  expect(() => assertExactPublicDeclaration(mutation, acceptedFingerprint)).toThrow(
    '[public-declaration-contract]',
  );
});

test('normalizes line endings before exact declaration comparison', () => {
  expect(() =>
    assertExactPublicDeclaration(accepted.replaceAll('\n', '\r\n'), acceptedFingerprint),
  ).not.toThrow();
});

test('accepts only the exact empty emitted JavaScript module for type-only layers', () => {
  expect(() =>
    assertTypeOnlyRuntimeModule(
      'dist/spec/example.js',
      'export {};\n//# sourceMappingURL=example.js.map\n',
    ),
  ).not.toThrow();
  expect(() =>
    assertTypeOnlyRuntimeModule(
      'dist/spec/example.js',
      'export const leaked = true;\n//# sourceMappingURL=example.js.map\n',
    ),
  ).toThrow('[type-only-runtime-contract]');
});
