import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const rootUrl = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, rootUrl), 'utf8');

const readme = read('README.md');
const architecture = read('docs/architecture.md');
const hostIntegration = read('docs/host-integration.md');

const API_VALUES = [
  'definePipeline',
  'compilePipeline',
  'decodeCompiledPipeline',
  'decidePipeline',
  'reducePipeline',
] as const;

const valueDeclarations = (document: string): readonly string[] =>
  [...document.matchAll(/export declare function (\w+)/gu)].map((match) => match[1]!);

describe('Consumer documentation contract', () => {
  test('states package status, purpose, installation, and runtime requirements', () => {
    expect(readme).toContain('# @revisium/revo-pipeline');
    expect(readme).toContain('Pre-release package. It is not published to npm');
    expect(readme).toContain('corepack pnpm add @revisium/revo-pipeline');
    expect(readme).toContain('Node.js `>=24.11.1 <25`');
    expect(readme).toContain('no runtime dependencies');
  });

  test('documents exactly the five runtime values', () => {
    expect(valueDeclarations(readme)).toEqual(API_VALUES);
    expect(new Set(valueDeclarations(readme)).size).toBe(API_VALUES.length);
  });

  test('keeps one executable quick start and live documentation links', () => {
    expect(readme).toContain('package-example:start:task-branch-terminal');
    expect(readme).toContain('package-example:end:task-branch-terminal');
    for (const path of [
      'docs/architecture.md',
      'docs/host-integration.md',
      'docs/specs',
      'docs/adr',
      'REPOSITORY.md',
      'VERIFICATION.md',
    ]) {
      expect(existsSync(new URL(path, rootUrl))).toBe(true);
    }
  });

  test('keeps package and host ownership explicit', () => {
    for (const document of [readme, architecture]) {
      expect(document).toContain('The host owns');
    }
    expect(hostIntegration).toContain('On conflict, discard all derived data');
    expect(hostIntegration).toContain('Never apply a batch prefix');
    expect(hostIntegration).toContain('write nothing');
  });
});
