import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { describe, expect, test, vi } from 'vitest';

import { compilePipeline, decidePipeline } from '../../src/index.js';
import type { PipelineDefinition, PipelineFacts } from '../../src/index.js';
import { validateCompiledPipeline } from '../../src/transition/index.js';

const linear = (): PipelineDefinition => ({
  schemaVersion: 1,
  entry: 'start',
  facts: [],
  nodes: [
    {
      kind: 'task',
      key: 'start',
      outcomes: { cancelled: 'end', completed: 'end', failed: 'end', skipped: 'end' },
    },
    { kind: 'terminal', key: 'end', outcome: 'done' },
  ],
});
const emptyFacts = (): PipelineFacts => ({
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
});

type FixtureManifest = {
  artifacts: { path: string; sha256: string }[];
  implementation: {
    capture: { path: string; sha256: string };
    verifier: { path: string; sha256: string };
    propertyEvaluator: { path: string; sha256: string };
  };
  provenance: {
    productionTreeSha256: string;
    graphFlowDigests: {
      owners: Record<string, string>;
      files: Record<string, string>;
    };
  };
  rootDigest: string;
};

const isFixtureManifest = (value: unknown): value is FixtureManifest =>
  typeof value === 'object' &&
  value !== null &&
  'artifacts' in value &&
  Array.isArray(value.artifacts) &&
  'implementation' in value &&
  typeof value.implementation === 'object' &&
  value.implementation !== null &&
  'provenance' in value &&
  typeof value.provenance === 'object' &&
  value.provenance !== null &&
  'rootDigest' in value &&
  typeof value.rootDigest === 'string';

const readFixtureManifest = async (path: string): Promise<FixtureManifest> => {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isFixtureManifest(value)) {
    throw new Error('Invalid fixture manifest');
  }
  return value;
};

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const stableJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const repositoryRoot = resolve(import.meta.dirname, '../..');

const createVerifierFixture = async (): Promise<string> => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'revo-characterization-'));
  await mkdir(resolve(fixture, 'scripts'), { recursive: true });
  await mkdir(resolve(fixture, 'test/characterization'), { recursive: true });
  await cp(resolve(repositoryRoot, 'src'), resolve(fixture, 'src'), { recursive: true });
  await cp(
    resolve(repositoryRoot, 'test/characterization/corpus'),
    resolve(fixture, 'test/characterization/corpus'),
    { recursive: true },
  );
  await Promise.all(
    [
      'scripts/verify-characterization.ts',
      'test/characterization/capture-characterization.ts',
      'test/characterization/evaluate-properties.ts',
      'test/characterization/manifest.json',
      'package.json',
    ].map((path) => cp(resolve(repositoryRoot, path), resolve(fixture, path))),
  );
  await symlink(resolve(repositoryRoot, 'node_modules'), resolve(fixture, 'node_modules'), 'dir');
  return fixture;
};

const verifierFailure = (fixture: string): string => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/verify-characterization.ts'],
    { cwd: fixture, encoding: 'utf8' },
  );
  if (result.status === 0) {
    throw new Error('Expected characterization verifier failure');
  }
  return result.stderr;
};

describe('immutable characterization controls', () => {
  test('the checked corpus agrees with current public behavior', async () => {
    const verifier = await import('../../scripts/verify-characterization.js');
    expect(verifier).toBeDefined();
    expect(() =>
      verifier.assertPermanentFrontierDecision({ kind: 'noop', reason: 'quiescent' }),
    ).toThrow('reference frontier emitted noop');
    expect(() =>
      verifier.assertPermanentFrontierDecision({
        kind: 'activate',
        cause: { kind: 'entry' },
        nodeKeys: [],
      }),
    ).toThrow('reference frontier emitted empty activation');
    expect(() =>
      verifier.assertReferenceClassification(true, {
        kind: 'reject',
        faults: [
          {
            code: 'FACT_CAUSAL',
            path: '/nodes/0',
            message: 'Mutant causal rejection.',
          },
        ],
      }),
    ).toThrow('reference-valid frontier received causal rejection');
  });

  test('compiler results survive JSON roundtrip, are deeply frozen, and isolate mutation', () => {
    const definition = linear();
    const result = compilePipeline(definition);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const snapshot = structuredClone(result.pipeline);
    expect(validateCompiledPipeline(JSON.parse(JSON.stringify(result.pipeline)))).toEqual({
      ok: true,
      pipeline: snapshot,
    });
    expect(Object.isFrozen(result.pipeline)).toBe(true);
    expect(Object.isFrozen(result.pipeline.nodes)).toBe(true);
    expect(Object.isFrozen(result.pipeline.nodes[0])).toBe(true);
    const first = definition.nodes[0];
    Reflect.set(definition.nodes, 0, definition.nodes[1]);
    Reflect.set(definition.nodes, 1, first);
    expect(result.pipeline).toEqual(snapshot);
  });

  test('source and fact permutations retain exact results', () => {
    const definition = linear();
    const permuted = { ...definition, nodes: [...definition.nodes].reverse() };
    expect(compilePipeline(permuted)).toEqual(compilePipeline(definition));
    const compilation = compilePipeline(definition);
    expect(compilation.ok).toBe(true);
    if (!compilation.ok) {
      return;
    }
    const facts: PipelineFacts = {
      ...emptyFacts(),
      nodes: [
        { key: 'start', state: 'terminal', outcome: 'completed' },
        { key: 'end', state: 'enabled' },
      ],
    };
    expect(decidePipeline(compilation.pipeline, facts)).toEqual(
      decidePipeline(compilation.pipeline, { ...facts, nodes: [...facts.nodes].reverse() }),
    );
  });

  test('descriptor inspection invokes neither definition nor compiled getters', () => {
    const definitionGetter = vi.fn<() => readonly unknown[]>(() => []);
    const hostileDefinition = {};
    Object.defineProperties(hostileDefinition, {
      schemaVersion: { value: 1, enumerable: true },
      entry: { value: 'end', enumerable: true },
      facts: { value: [], enumerable: true },
      nodes: { get: definitionGetter, enumerable: true },
    });
    expect(() => {
      Reflect.apply(compilePipeline, undefined, [hostileDefinition]);
    }).not.toThrow();
    expect(definitionGetter).not.toHaveBeenCalled();

    const compiledGetter = vi.fn<() => readonly unknown[]>(() => []);
    const hostileCompiled = {};
    Object.defineProperty(hostileCompiled, 'nodes', { get: compiledGetter, enumerable: true });
    expect(validateCompiledPipeline(hostileCompiled)).toEqual({ ok: false });
    expect(compiledGetter).not.toHaveBeenCalled();
  });

  test('bounds and the 99-plus-sentinel fault truncation stay exact', () => {
    const oversized = compilePipeline({
      schemaVersion: 1,
      entry: 'missing',
      facts: [],
      nodes: Array.from({ length: 257 }, (_, index) => ({
        kind: 'terminal' as const,
        key: `node-${index}`,
        outcome: 'done',
      })),
    });
    expect(oversized).toMatchObject({
      ok: false,
      faults: [{ code: 'DEF_LIMIT', path: '/nodes' }],
    });

    const nodes = Array.from({ length: 101 }, () => ({
      kind: 'terminal' as const,
      key: 'duplicate',
      outcome: 'done',
    }));
    const result = compilePipeline({
      schemaVersion: 1,
      entry: 'missing',
      facts: [],
      nodes,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.faults).toHaveLength(100);
    expect(result.faults.at(-1)).toEqual({
      code: 'DEF_LIMIT',
      path: '',
      message: 'Fault limit exceeded.',
    });
  });

  test('manifest stays canonical JSON with a terminal newline', async () => {
    const source = await readFile(new URL('./manifest.json', import.meta.url), 'utf8');
    expect(source.endsWith('\n')).toBe(true);
    expect(`${JSON.stringify(JSON.parse(source), null, 2)}\n`).toBe(source);
  });

  test('verifier rejects a self-consistent manifest with changed production provenance', async () => {
    const fixture = await createVerifierFixture();
    try {
      const path = resolve(fixture, 'test/characterization/manifest.json');
      const manifest = await readFixtureManifest(path);
      manifest.provenance.productionTreeSha256 = '0'.repeat(64);
      await writeFile(path, stableJson(manifest));
      expect(verifierFailure(fixture)).toContain('production tree provenance drifted');
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test('verifier rejects coherently refreshed artifact and root digests', async () => {
    const fixture = await createVerifierFixture();
    try {
      const manifestPath = resolve(fixture, 'test/characterization/manifest.json');
      const artifactPath = resolve(fixture, 'test/characterization/corpus/inputs/properties.json');
      await writeFile(artifactPath, `${await readFile(artifactPath, 'utf8')} `);
      const manifest = await readFixtureManifest(manifestPath);
      const artifact = manifest.artifacts.find(
        ({ path }) => path === 'corpus/inputs/properties.json',
      );
      if (!artifact) {
        throw new Error('Missing property artifact');
      }
      artifact.sha256 = sha256(await readFile(artifactPath));
      manifest.rootDigest = sha256(
        manifest.artifacts.map(({ path, sha256: digest }) => `${path}\0${digest}`).join(''),
      );
      await writeFile(manifestPath, stableJson(manifest));
      expect(verifierFailure(fixture)).toContain('accepted corpus root drifted');
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test('verifier rejects an implementation path redirect with its matching hash', async () => {
    const fixture = await createVerifierFixture();
    try {
      const manifestPath = resolve(fixture, 'test/characterization/manifest.json');
      const redirected = 'test/characterization/redirected-capture.ts';
      await cp(
        resolve(fixture, 'test/characterization/capture-characterization.ts'),
        resolve(fixture, redirected),
      );
      const manifest = await readFixtureManifest(manifestPath);
      manifest.implementation.capture.path = redirected;
      manifest.implementation.capture.sha256 = sha256(await readFile(resolve(fixture, redirected)));
      await writeFile(manifestPath, stableJson(manifest));
      expect(verifierFailure(fixture)).toContain('capture implementation path drifted');
    } finally {
      await rm(fixture, { recursive: true, force: true });
    }
  });

  test('verifier rejects missing, extra, and mutated graph-flow inventory entries', async () => {
    const mutations = [
      (manifest: FixtureManifest) => {
        delete manifest.provenance.graphFlowDigests.owners[
          'src/definition/compile-pipeline.ts#compilePipeline'
        ];
      },
      (manifest: FixtureManifest) => {
        manifest.provenance.graphFlowDigests.files['src/graph/unexpected.ts'] = '0'.repeat(64);
      },
      (manifest: FixtureManifest) => {
        manifest.provenance.graphFlowDigests.owners[
          'src/definition/compile-pipeline.ts#compilePipeline'
        ] = '0'.repeat(64);
      },
    ];
    const failures = await Promise.all(
      mutations.map(async (mutate) => {
        const fixture = await createVerifierFixture();
        try {
          const manifestPath = resolve(fixture, 'test/characterization/manifest.json');
          const manifest = await readFixtureManifest(manifestPath);
          mutate(manifest);
          await writeFile(manifestPath, stableJson(manifest));
          return verifierFailure(fixture);
        } finally {
          await rm(fixture, { recursive: true, force: true });
        }
      }),
    );
    expect(failures).toHaveLength(3);
    expect(
      failures.every((failure) => failure.includes('graph-flow digest inventory drifted')),
    ).toBe(true);
  });
});
