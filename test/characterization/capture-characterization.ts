import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { compilePipeline, decidePipeline } from '../../src/index.js';
import type { PipelineDefinition, PipelineFacts } from '../../src/index.js';
import { evaluateProperties } from './evaluate-properties.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const corpus = resolve(root, 'test/characterization/corpus');
const inputs = resolve(corpus, 'inputs');
const outputs = resolve(corpus, 'outputs');
const baseSha = 'c5dafd574269c230e4921614a481fc7277f2ff00';
const execute = promisify(execFile);

type CompilerCase = { readonly id: string; readonly definition: PipelineDefinition };
type DecisionCase = CompilerCase & { readonly facts: PipelineFacts };

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
const isCompilerCase = (value: unknown): value is CompilerCase =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof value.id === 'string' &&
  'definition' in value &&
  typeof value.definition === 'object' &&
  value.definition !== null;
const isDecisionCase = (value: unknown): value is DecisionCase =>
  isCompilerCase(value) &&
  'facts' in value &&
  typeof value.facts === 'object' &&
  value.facts !== null;
const requireCases = <T>(
  value: unknown,
  predicate: (item: unknown) => item is T,
  label: string,
): readonly T[] => {
  if (!Array.isArray(value) || !value.every(predicate)) {
    throw new Error(`Invalid characterization ${label}`);
  }
  return value;
};

const stableJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const listFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat().sort();
};
const treeDigest = async (directory: string): Promise<string> => {
  const records = await Promise.all(
    (await listFiles(directory)).map(
      async (path) => `${relative(root, path)}\0${sha256(await readFile(path))}`,
    ),
  );
  return sha256(records.join(''));
};

const compilerCases = requireCases(
  await readJson(resolve(inputs, 'compiler.json')),
  isCompilerCase,
  'compiler inputs',
);
const decisionCases = requireCases(
  await readJson(resolve(inputs, 'decisions.json')),
  isDecisionCase,
  'decision inputs',
);

const compilerOutputs = compilerCases.map(({ id, definition }) => ({
  id,
  output: compilePipeline(definition),
}));
const decisionOutputs = decisionCases.map(({ id, definition, facts }) => {
  const compilation = compilePipeline(definition);
  return {
    id,
    compilation,
    decision: compilation.ok ? decidePipeline(compilation.pipeline, facts) : compilation,
  };
});
const propertyIds = requireCases(
  await readJson(resolve(inputs, 'properties.json')),
  (value): value is string => typeof value === 'string',
  'property inputs',
);
const propertyOutputs = evaluateProperties(propertyIds);

await writeFile(resolve(outputs, 'compiler.json'), stableJson(compilerOutputs));
await writeFile(resolve(outputs, 'decisions.json'), stableJson(decisionOutputs));
await writeFile(resolve(outputs, 'properties.json'), stableJson(propertyOutputs));
await execute(
  'corepack',
  [
    'pnpm',
    'exec',
    'oxfmt',
    '--write',
    resolve(outputs, 'compiler.json'),
    resolve(outputs, 'decisions.json'),
    resolve(outputs, 'properties.json'),
  ],
  { cwd: root },
);

const artifactPaths = (
  await Promise.all(
    ['inputs', 'outputs'].map(async (directory) =>
      (await readdir(resolve(corpus, directory))).map((name) => `corpus/${directory}/${name}`),
    ),
  )
)
  .flat()
  .sort();
const artifacts = await Promise.all(
  artifactPaths.map(async (path) => ({
    path,
    sha256: sha256(await readFile(resolve(root, 'test/characterization', path))),
  })),
);
const rootDigest = sha256(
  artifacts.map(({ path, sha256: digest }) => `${path}\0${digest}`).join(''),
);
const implementation = async (path: string): Promise<string> =>
  sha256(await readFile(resolve(root, path)));

await writeFile(
  resolve(root, 'test/characterization/manifest.json'),
  stableJson({
    formatVersion: 1,
    provenance: {
      repository: '@revisium/revo-pipeline',
      pr3Sha: baseSha,
      implementationBriefSha256: '32f42beb2194e8a4c06317ff871fd102354c9022a72500a693174d8747950933',
      schemas: { pipelineDefinition: 1, compiledPipeline: 1, pipelineFacts: 1 },
      node: '>=24.11.1 <25',
      pnpm: '11.13.0',
      productionTreeSha256: await treeDigest(resolve(root, 'src')),
      graphFlowDigests: {
        owners: {
          'src/definition/compile-pipeline.ts#compilePipeline':
            '5e601cebbdf06ebe1882a7a46b2ce1485ed27c331eafd94b4eca0362259c1669',
          'src/definition/compile-pipeline.ts#preflightForkRegions':
            'f619d28422ddc193db794b6be3a10d851215cf271c135128f71f16be5aac5528',
          'src/definition/compile-pipeline.ts#classifyForkRegions':
            'd4e293cc77b4548642ee22f8a3d18e4f079c829bd57ff08df5f2527a82f44eb1',
          'src/transition/validate-compiled-internally.ts#validateCompiledInternally':
            'a67ae89bf1609012ca61ddb8af71d4d1977fb706a7fd5b5c716374677630aed6',
          'src/transition/validate-compiled-internally.ts#canonicalCoreGraph':
            '14bd423f973be6e501259781a512d0c217154189f53bd4e8561e914a9cc25267',
          'src/transition/validate-compiled-internally.ts#canonicalRegions':
            '7ed0e7ad7eccc190c19b6fefb899144d300c095d1fa0c55b221a5cfbbcdc3b9a',
          'src/transition/validate-compiled-internally.ts#independentlyDerivedRegionMembers':
            'e34e5e22da2f182384cbffd75ade50e4aa25f194e8c9805033e9e9d9dd9cd084',
        },
        files: {
          'src/definition/compile-pipeline.ts':
            'f061385d4fa3ee91972301b589afc0a9a5c16de4ed00d2cab322011ce6f63acc',
          'src/transition/validate-compiled-internally.ts':
            'dff379567b2b2fac80d733e248f806182788127c13f7dece9959ed76f7a8958d',
        },
      },
    },
    artifacts,
    implementation: {
      capture: {
        path: relative(root, fileURLToPath(import.meta.url)),
        sha256: await implementation('test/characterization/capture-characterization.ts'),
      },
      verifier: {
        path: 'scripts/verify-characterization.ts',
        sha256: await implementation('scripts/verify-characterization.ts'),
      },
      propertyEvaluator: {
        path: 'test/characterization/evaluate-properties.ts',
        sha256: await implementation('test/characterization/evaluate-properties.ts'),
      },
    },
    rootDigest,
  }),
);
