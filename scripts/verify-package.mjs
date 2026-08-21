import { spawnSync } from 'node:child_process';
import {
  cpSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'revo-pipeline-smoke-'));
const environment = {
  ...process.env,
  NO_COLOR: '1',
  npm_config_cache: join(temporaryRoot, 'npm-cache'),
};

/** @param {string} command @param {readonly string[]} arguments_ @param {string} [cwd] */
const run = (command, arguments_, cwd = repositoryRoot) => {
  const result = spawnSync(command, arguments_, { cwd, encoding: 'utf8', env: environment });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${arguments_.join(' ')} failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    );
  }
  return result;
};

/** @param {string} directory */
const soleTarball = (directory) => {
  const tarballs = readdirSync(directory)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(directory, name));
  if (tarballs.length !== 1 || tarballs[0] === undefined) {
    throw new Error(`Expected one tarball in ${directory}.`);
  }
  return tarballs[0];
};

const runtimeProbe = `
import { createRequire } from 'node:module';
import * as root from '@revisium/revo-pipeline';
import * as kernel from '@revisium/revo-pipeline/kernel';
import * as executionPlan from '@revisium/revo-pipeline/execution-plan';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const expectedRoot = ${JSON.stringify([
  'PipelineCompileResultSchema',
  'PipelineProgramSchema',
  'PipelineSourcePackageSchema',
  'ProfileMaterializationSchema',
  'ProgramDigestInputSchema',
  'ProgramProvenanceSchema',
  'ProgramRequirementsSchema',
  'ValueSchemaSchema',
  'compilePipeline',
  'computeMaterializationDigest',
  'computeProgramDigest',
  'computeSourceDigest',
  'definePipelineSource',
  'defineProfileMaterialization',
])};
const expectedKernel = ${JSON.stringify([
  'InitialPipelineTransitionSchema',
  'KernelProgramSchema',
  'PipelineCommandSchema',
  'PipelineEventSchema',
  'PipelineProgramSchema',
  'PipelineStateSchema',
  'PipelineTransitionSchema',
  'advancePipeline',
  'createInitialPipelineState',
])};
const expectedExecutionPlan = ${JSON.stringify(['compileToExecutionPlan'])};
assert(JSON.stringify(Object.keys(root).sort()) === JSON.stringify(expectedRoot.sort()), 'Root export drift.');
assert(JSON.stringify(Object.keys(kernel).sort()) === JSON.stringify(expectedKernel.sort()), 'Kernel export drift.');
assert(JSON.stringify(Object.keys(executionPlan).sort()) === JSON.stringify(expectedExecutionPlan.sort()), 'execution-plan export drift.');
assert(root.PipelineProgramSchema === kernel.PipelineProgramSchema, 'Program schema identity drift.');
assert(!Object.hasOwn(root, 'default') && !Object.hasOwn(kernel, 'default') && !Object.hasOwn(executionPlan, 'default'), 'Default export present.');

for (const specifier of [
  '@revisium/revo-pipeline/package.json',
  '@revisium/revo-pipeline/dist/index.js',
  '@revisium/revo-pipeline/kernel/index',
  '@revisium/revo-pipeline/unknown',
]) {
  try {
    await import(specifier);
    throw new Error(\`Deep import unexpectedly succeeded: \${specifier}.\`);
  } catch (error) {
    assert(error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED', \`Wrong deep-import failure for \${specifier}.\`);
  }
}

const require = createRequire(import.meta.url);
for (const specifier of ['@revisium/revo-pipeline', '@revisium/revo-pipeline/kernel', '@revisium/revo-pipeline/execution-plan']) {
  try {
    require(specifier);
    throw new Error(\`CommonJS import unexpectedly succeeded: \${specifier}.\`);
  } catch (error) {
    assert(error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED', \`Wrong CommonJS failure for \${specifier}.\`);
  }
}

`;

const executionPlanSource = `
import {
  computeSourceDigest,
  definePipelineSource,
  defineProfileMaterialization,
} from '@revisium/revo-pipeline';
import { compileToExecutionPlan } from '@revisium/revo-pipeline/execution-plan';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const emptyObject = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
};
const source = definePipelineSource({
  schemaVersion: 'pipeline-source/v1',
  key: 'execution-plan-smoke',
  entryModule: 'main',
  maximumTotalActivities: 3,
  modules: [{
    key: 'main',
    inputSchema: emptyObject,
    outputSchema: emptyObject,
    region: {
      key: 'root',
      inputSchema: emptyObject,
      entry: 'select',
      outputSchema: emptyObject,
      exits: [{ outcome: 'ok', outputSchema: emptyObject }],
      nodes: [
        {
          kind: 'choice',
          key: 'select',
          selector: { kind: 'literal', value: 'yes' },
          cases: [{ key: 'yes', when: { kind: 'equals', value: 'yes' }, target: 'accepted' }],
          otherwise: 'rejected',
        },
        { kind: 'end', key: 'accepted', outcome: 'ok', output: {} },
        { kind: 'end', key: 'rejected', outcome: 'ok', output: {} },
      ],
    },
  }],
});
const materialization = defineProfileMaterialization({
  schemaVersion: 'pipeline-materialization/v1',
  sourceDigest: computeSourceDigest(source),
  slots: [],
});
const result = compileToExecutionPlan(source, materialization, {
  bindings: [],
  policies: {
    defaultTaskTimeoutMs: 60_000,
    maximumActiveNodeExecutions: 1,
    maximumNodeNestingDepth: 4,
    maximumSubpipelineDepth: 1,
    maximumTotalNodeExecutions: 4,
  },
});
assert(result.stage === 'execution-plan' && result.ok, 'Execution-plan lowering failed.');
assert(result.executionPlan.rootPipelineId.startsWith('pipeline_'), 'Execution-plan root identity drift.');
assert(Object.hasOwn(result.executionPlan.pipelines, result.executionPlan.rootPipelineId), 'Execution-plan root is missing.');
`;

const executionPlanTypeProbe = `
import {
  computeSourceDigest,
  definePipelineSource,
  defineProfileMaterialization,
} from '@revisium/revo-pipeline';
import {
  compileToExecutionPlan,
  type PipelineExecutionPlan,
  type PipelineExecutionPlanOptions,
} from '@revisium/revo-pipeline/execution-plan';

const emptyObject = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} as const;
const source = definePipelineSource({
  schemaVersion: 'pipeline-source/v1',
  key: 'execution-plan-type-smoke',
  entryModule: 'main',
  maximumTotalActivities: 1,
  modules: [{
    key: 'main',
    inputSchema: emptyObject,
    outputSchema: emptyObject,
    region: {
      key: 'root',
      inputSchema: emptyObject,
      entry: 'done',
      outputSchema: emptyObject,
      exits: [{ outcome: 'ok', outputSchema: emptyObject }],
      nodes: [{ kind: 'end', key: 'done', outcome: 'ok', output: {} }],
    },
  }],
});
const materialization = defineProfileMaterialization({
  schemaVersion: 'pipeline-materialization/v1',
  sourceDigest: computeSourceDigest(source),
  slots: [],
});
const options: PipelineExecutionPlanOptions = {
  bindings: [],
  policies: {
    defaultTaskTimeoutMs: 60_000,
    maximumActiveNodeExecutions: 1,
    maximumNodeNestingDepth: 1,
    maximumSubpipelineDepth: 1,
    maximumTotalNodeExecutions: 1,
  },
};
const result = compileToExecutionPlan(source, materialization, options);
if (result.stage === 'execution-plan' && result.ok) {
  const plan: PipelineExecutionPlan = result.executionPlan;
  void plan;
}
`;

try {
  rmSync(join(repositoryRoot, 'dist'), { recursive: true, force: true });
  const packRoot = join(temporaryRoot, 'package');
  mkdirSync(packRoot);
  run('npm', ['pack', '--pack-destination', packRoot]);
  const tarball = soleTarball(packRoot);

  const entries = run('tar', ['-tzf', tarball]).stdout.trim().split(/\r?\n/u);
  const files = entries.filter((path) => !path.endsWith('/'));
  for (const required of ['package/LICENSE', 'package/README.md', 'package/package.json']) {
    if (!files.includes(required)) {
      throw new Error(`Packed output is missing ${required}.`);
    }
  }
  for (const path of files) {
    if (
      !['package/LICENSE', 'package/README.md', 'package/package.json'].includes(path) &&
      !/^package\/dist\/.+\.(?:d\.ts|js)$/u.test(path)
    ) {
      throw new Error(`Packed output contains a forbidden file: ${path}.`);
    }
  }
  if (
    files.some((path) => path.endsWith('.map')) ||
    !files.some((path) => path.endsWith('.d.ts'))
  ) {
    throw new Error('Packed declarations are missing or source maps are present.');
  }

  run('corepack', ['pnpm', 'exec', 'publint', 'run', tarball, '--strict', '--pack=false']);
  run('corepack', [
    'pnpm',
    'exec',
    'attw',
    tarball,
    '--profile',
    'esm-only',
    '--entrypoints',
    '.',
    './kernel',
    './execution-plan',
    '--no-definitely-typed',
    '--no-summary',
    '--no-emoji',
    '--no-color',
  ]);

  const consumerRoot = join(temporaryRoot, 'consumer');
  mkdirSync(consumerRoot);
  writeFileSync(join(consumerRoot, 'package.json'), '{"private":true,"type":"module"}\n');
  writeFileSync(
    join(consumerRoot, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: {
        target: 'ES2024',
        lib: ['ES2024', 'DOM'],
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        exactOptionalPropertyTypes: true,
        noEmit: true,
        skipLibCheck: false,
      },
      files: ['quick-start.ts', 'execution-plan.ts'],
    })}\n`,
  );
  cpSync(join(repositoryRoot, 'examples', 'quick-start.ts'), join(consumerRoot, 'quick-start.ts'));
  writeFileSync(join(consumerRoot, 'surface.mjs'), runtimeProbe);
  writeFileSync(join(consumerRoot, 'execution-plan.mjs'), executionPlanSource);
  writeFileSync(join(consumerRoot, 'execution-plan.ts'), executionPlanTypeProbe);
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], consumerRoot);

  const installed = join(consumerRoot, 'node_modules', '@revisium', 'revo-pipeline');
  if (
    lstatSync(installed).isSymbolicLink() ||
    realpathSync(installed).startsWith(`${resolve(repositoryRoot)}${sep}`)
  ) {
    throw new Error('Smoke linked the repository checkout instead of installing the tarball.');
  }

  run(
    process.execPath,
    [join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', consumerRoot],
    consumerRoot,
  );
  run(process.execPath, ['quick-start.ts'], consumerRoot);
  run(process.execPath, ['surface.mjs'], consumerRoot);
  run(process.execPath, ['execution-plan.mjs'], consumerRoot);
  process.stdout.write(`Verified ${basename(tarball)} with the tracked quick-start.\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
