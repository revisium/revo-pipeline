import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import {
  validateModuleStructure,
  type SourceModule,
} from './architecture/validate-module-structure.js';

interface PackFile {
  readonly path: string;
}

interface PackManifest {
  readonly filename: string;
  readonly files: readonly PackFile[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const commandOutputText = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  return Buffer.isBuffer(value) ? value.toString('utf8') : '';
};

const commandFailureOutput = (error: unknown): string => {
  if (!isRecord(error)) {
    return String(error);
  }
  return `${commandOutputText(error['stdout'])}${commandOutputText(error['stderr'])}`;
};

const isPackManifest = (value: unknown): value is PackManifest =>
  isRecord(value) &&
  typeof value.filename === 'string' &&
  Array.isArray(value.files) &&
  value.files.every((file: unknown) => isRecord(file) && typeof file.path === 'string');

const collectSourceModules = async (
  root: string,
  directory: string,
): Promise<readonly SourceModule[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry): Promise<readonly SourceModule[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectSourceModules(root, path);
      }
      if (!entry.name.endsWith('.ts')) {
        return [];
      }
      return [
        { path: relative(root, path).replaceAll('\\', '/'), source: await readFile(path, 'utf8') },
      ];
    }),
  );
  return groups.flat();
};

const expectedPackagePaths = (sourceModules: readonly SourceModule[]): readonly string[] => {
  validateModuleStructure(sourceModules);
  const compilerEmissions = sourceModules.flatMap(({ path }) => {
    assert.match(path, /^src\/.*\.ts$/);
    const output = `dist/${path.slice('src/'.length, -'.ts'.length)}`;
    return [`${output}.d.ts`, `${output}.d.ts.map`, `${output}.js`, `${output}.js.map`];
  });
  return ['LICENSE', 'README.md', 'package.json', ...compilerEmissions].sort();
};

const packagePath = (root: string, packageName: string): string =>
  join(root, ...packageName.split('/'));

const linkPackage = async (
  sourceNodeModules: string,
  targetNodeModules: string,
  packageName: string,
): Promise<void> => {
  const target = packagePath(targetNodeModules, packageName);
  await mkdir(dirname(target), { recursive: true });
  await symlink(packagePath(sourceNodeModules, packageName), target, 'dir');
};

const runtimeConsumer = `
import assert from 'node:assert/strict';
import {
  compilePipeline,
  decidePipeline,
  definePipeline,
} from '@revisium/revo-pipeline';
import * as packageEntry from '@revisium/revo-pipeline';

assert.deepEqual(Object.keys(packageEntry).sort(), [
  'compilePipeline',
  'decidePipeline',
  'definePipeline',
]);

const definition = definePipeline({
  schemaVersion: 1,
  entry: 'approval',
  facts: [],
  nodes: [
    {
      kind: 'humanGate',
      key: 'approval',
      subject: 'Approve the change',
      resolutions: [
        { resolution: 'approved', to: 'published' },
        { resolution: 'rejected', to: 'cancelled' },
      ],
    },
    { kind: 'terminal', key: 'published', outcome: 'published' },
    { kind: 'terminal', key: 'cancelled', outcome: 'cancelled' },
  ],
});
const compilation = compilePipeline(definition);
assert.equal(compilation.ok, true);
if (!compilation.ok) throw new Error('The packed example must compile.');
const pipeline = JSON.parse(JSON.stringify(compilation.pipeline));
const emptyFacts = { values: [], nodes: [], candidateVerdicts: [], gateResolutions: [] };
assert.deepEqual(decidePipeline(pipeline, emptyFacts), {
  kind: 'activate',
  cause: { kind: 'entry' },
  nodeKeys: ['approval'],
});
const unresolvedFacts = {
  ...emptyFacts,
  nodes: [{ key: 'approval', state: 'enabled' }],
};
assert.deepEqual(decidePipeline(pipeline, unresolvedFacts), {
  kind: 'wait',
  nodeKey: 'approval',
  reason: 'gate-unresolved',
});
const resolvedFacts = {
  ...unresolvedFacts,
  gateResolutions: [{ nodeKey: 'approval', resolution: 'approved' }],
};
const selected = {
  kind: 'select',
  nodeKey: 'approval',
  outcome: 'approved',
  activate: ['published'],
};
assert.deepEqual(decidePipeline(pipeline, resolvedFacts), selected);
assert.deepEqual(decidePipeline(pipeline, resolvedFacts), selected);

await assert.rejects(
  import('@revisium/revo-pipeline/dist/index.js'),
  (error) => error instanceof Error && 'code' in error && error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
);
`;

const typeConsumer = `
import {
  compilePipeline,
  decidePipeline,
  definePipeline,
  type ActivateDecision,
  type ActivationCause,
  type AllJoinPolicy,
  type AnyJoinPolicy,
  type BranchCase,
  type BranchDefault,
  type BranchName,
  type BranchNode,
  type BranchPredicate,
  type CandidateKey,
  type CandidateVerdict,
  type CompiledEdge,
  type CompiledEdgeIndexEntry,
  type CompiledEdgeRole,
  type CompiledForkBranch,
  type CompiledForkRegion,
  type CompiledNode,
  type CompiledNodeIndexEntry,
  type CompiledPipeline,
  type ConsensusNode,
  type ConsensusOutcome,
  type ConsensusPolicy,
  type ConsensusRoutes,
  type DecisionFault,
  type DecisionFaultCode,
  type DefinitionFault,
  type DefinitionFaultCode,
  type FactDefinition,
  type FactKey,
  type FactType,
  type ForkBranch,
  type ForkNode,
  type GateResolution,
  type HumanGateNode,
  type HumanGateRoute,
  type JoinNode,
  type JoinOutcome,
  type JoinPolicy,
  type JoinRoutes,
  type JsonScalar,
  type NodeFact,
  type NodeKey,
  type NoopDecision,
  type PipelineCompilation,
  type PipelineDecision,
  type PipelineDefinition,
  type PipelineFacts,
  type PipelineNode,
  type PipelineValueFact,
  type QuorumConsensusPolicy,
  type RejectDecision,
  type ResolutionName,
  type SelectDecision,
  type TaskNode,
  type TaskOutcome,
  type TaskRoutes,
  type TerminalDecision,
  type TerminalNode,
  type ThresholdConsensusPolicy,
  type ThresholdJoinPolicy,
  type UnanimousConsensusPolicy,
  type WaitDecision,
  type WaitReason,
} from '@revisium/revo-pipeline';

type PublicTypes = readonly [
  JsonScalar, NodeKey, FactKey, CandidateKey, BranchName, ResolutionName, TaskOutcome,
  FactType, FactDefinition, TaskRoutes, BranchPredicate, BranchCase, BranchDefault,
  ForkBranch, AllJoinPolicy, AnyJoinPolicy, ThresholdJoinPolicy, JoinPolicy, JoinOutcome,
  JoinRoutes, UnanimousConsensusPolicy, QuorumConsensusPolicy, ThresholdConsensusPolicy,
  ConsensusPolicy, ConsensusOutcome, ConsensusRoutes, HumanGateRoute, TaskNode, BranchNode,
  ForkNode, JoinNode, ConsensusNode, HumanGateNode, TerminalNode, PipelineNode,
  PipelineDefinition, CompiledNode, CompiledEdgeRole, CompiledEdge, CompiledForkBranch,
  CompiledForkRegion, CompiledNodeIndexEntry, CompiledEdgeIndexEntry, CompiledPipeline,
  DefinitionFaultCode, DefinitionFault, PipelineCompilation, NodeFact, PipelineValueFact,
  CandidateVerdict, GateResolution, PipelineFacts, ActivationCause, WaitReason,
  DecisionFaultCode, DecisionFault, ActivateDecision, SelectDecision, WaitDecision,
  TerminalDecision, NoopDecision, RejectDecision, PipelineDecision,
];
const publicTypeCount: 63 = null as unknown as PublicTypes['length'];

const definition = definePipeline({
  schemaVersion: 1,
  entry: 'approval',
  facts: [],
  nodes: [
    {
      kind: 'humanGate',
      key: 'approval',
      subject: 'Approve the change',
      resolutions: [{ resolution: 'approved', to: 'published' }],
    },
    { kind: 'terminal', key: 'published', outcome: 'published' },
  ],
});
const literalEntry: 'approval' = definition.entry;
const literalKind: 'humanGate' = definition.nodes[0].kind;
const compilation: PipelineCompilation = compilePipeline(definition);
if (compilation.ok) {
  const facts: PipelineFacts = {
    values: [],
    nodes: [{ key: 'approval', state: 'enabled' }],
    candidateVerdicts: [],
    gateResolutions: [],
  };
  const decision: PipelineDecision = decidePipeline(compilation.pipeline, facts);
  void decision;
}
void publicTypeCount;
void literalEntry;
void literalKind;
`;

const privateTypeConsumer = `
import type * as PrivateEntry from '@revisium/revo-pipeline/dist/index.js';
export type LeakedPrivateEntry = typeof PrivateEntry;
`;

const consumerTsconfig = {
  compilerOptions: {
    target: 'ES2024',
    lib: ['ES2024'],
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    moduleDetection: 'force',
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noEmit: true,
    skipLibCheck: false,
    types: ['node'],
  },
  include: ['consumer.ts'],
};

const root = process.cwd();
const sourceModules = await collectSourceModules(root, join(root, 'src'));
const expectedPaths = expectedPackagePaths(sourceModules);
const temporaryRoot = await mkdtemp(join(tmpdir(), 'revo-pipeline-package-'));
const packDirectory = join(temporaryRoot, 'package');
const consumerDirectory = join(temporaryRoot, 'consumer');
const consumerNodeModules = join(consumerDirectory, 'node_modules');

try {
  await mkdir(packDirectory);
  await mkdir(consumerDirectory);
  const output = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', packDirectory],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: join(temporaryRoot, 'npm-cache'),
        npm_config_loglevel: 'silent',
      },
    },
  );
  const parsed: unknown = JSON.parse(output);
  assert.ok(Array.isArray(parsed) && parsed.length === 1);
  const manifest: unknown = parsed[0];
  assert.ok(isPackManifest(manifest));
  assert.deepEqual(
    manifest.files.map(({ path }) => path).sort(),
    expectedPaths,
    'The exact tarball contents must equal source-derived compiler emissions and fixed metadata.',
  );
  const tarball = join(packDirectory, manifest.filename);

  execFileSync('publint', [tarball, '--strict'], { cwd: root, stdio: 'inherit' });
  execFileSync('attw', [tarball, '--profile', 'esm-only'], { cwd: root, stdio: 'inherit' });

  const installedPackage = packagePath(consumerNodeModules, '@revisium/revo-pipeline');
  await mkdir(installedPackage, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', installedPackage, '--strip-components=1']);
  const packedManifest: unknown = JSON.parse(
    await readFile(join(installedPackage, 'package.json'), 'utf8'),
  );
  assert.ok(isRecord(packedManifest));
  assert.equal(packedManifest['dependencies'], undefined, 'Runtime dependencies must remain zero.');
  assert.deepEqual(packedManifest['exports'], {
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.js',
    },
  });
  await linkPackage(join(root, 'node_modules'), consumerNodeModules, '@types/node');

  await writeFile(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, undefined, 2)}\n`,
  );
  await writeFile(join(consumerDirectory, 'consumer.mjs'), runtimeConsumer);
  await writeFile(join(consumerDirectory, 'consumer.ts'), typeConsumer);
  await writeFile(join(consumerDirectory, 'private-consumer.ts'), privateTypeConsumer);
  await writeFile(
    join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify(consumerTsconfig, undefined, 2)}\n`,
  );

  execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
    cwd: consumerDirectory,
    stdio: 'pipe',
  });
  await writeFile(
    join(consumerDirectory, 'tsconfig.private.json'),
    `${JSON.stringify({ ...consumerTsconfig, include: ['private-consumer.ts'] }, undefined, 2)}\n`,
  );
  assert.throws(
    () =>
      execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.private.json'], {
        cwd: consumerDirectory,
        stdio: 'pipe',
      }),
    (error: unknown) => commandFailureOutput(error).includes('TS2307'),
    'A private type-level deep import from the exact tarball must fail TypeScript resolution.',
  );
  execFileSync(process.execPath, ['consumer.mjs'], {
    cwd: consumerDirectory,
    stdio: 'pipe',
  });

  console.log(
    `Exact tarball validation passed (${manifest.files.length} files; publint, ATTW, exact contents, ESM, all 63 types, runtime/type deep-import denial).`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
