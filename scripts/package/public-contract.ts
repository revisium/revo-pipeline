import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export const PUBLIC_DECLARATION_SHA256 =
  '711b215da230fc37b3befdfe96a35e480355bf2a232ea17d31b997002dff552a';

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
