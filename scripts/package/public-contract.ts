import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export const PUBLIC_DECLARATION_SHA256 =
  'b4b79a6cd5bbf8a8d23334a50f7e70dd3e1220f0a9624fe058398eca84d2108f';

export const normalizePublicDeclaration = (content: string): string =>
  `${content.replaceAll('\r\n', '\n').trimEnd()}\n`;

export const publicDeclarationFingerprint = (content: string): string =>
  createHash('sha256').update(normalizePublicDeclaration(content)).digest('hex');

export const assertExactPublicDeclaration = (
  content: string,
  expectedFingerprint = PUBLIC_DECLARATION_SHA256,
): void => {
  const actual = publicDeclarationFingerprint(content);
  if (actual !== expectedFingerprint) {
    throw new Error(
      `[public-declaration-contract] expected sha256 ${expectedFingerprint}; received ${actual}`,
    );
  }
};

export const assertTypeOnlyRuntimeModule = (label: string, content: string): void => {
  const expected = `export {};\n//# sourceMappingURL=${basename(label)}.map\n`;
  if (normalizePublicDeclaration(content) !== expected) {
    throw new Error(`[type-only-runtime-contract] ${label}`);
  }
};
