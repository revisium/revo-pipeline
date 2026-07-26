import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import {
  validateModuleStructure,
  type ArchitectureRule,
  type SourceModule,
} from './architecture/validate-module-structure.js';

const root = process.cwd();
const oxlint = join(root, 'node_modules/.bin/oxlint');
const config = join(root, '.oxlintrc.architecture.json');

const collectModules = async (directory: string): Promise<readonly SourceModule[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(
    entries.map(async (entry): Promise<readonly SourceModule[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectModules(path);
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

const failureOutput = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) {
    return String(error);
  }
  const stdout =
    'stdout' in error && Buffer.isBuffer(error.stdout) ? error.stdout.toString('utf8') : '';
  const stderr =
    'stderr' in error && Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : '';
  return `${stdout}${stderr}`;
};

const expectLintFailure = (paths: readonly string[], rule: string): void => {
  try {
    execFileSync(oxlint, ['--config', config, '--deny-warnings', ...paths], {
      cwd: root,
      stdio: 'pipe',
    });
  } catch (error: unknown) {
    assert.match(failureOutput(error), new RegExp(rule.replace(/[()]/g, '\\$&')));
    return;
  }
  assert.fail(`Expected architecture probe to fail with ${rule}`);
};

const runArchitectureLint = (paths: readonly string[]): void => {
  execFileSync(oxlint, ['--config', config, '--deny-warnings', ...paths], {
    cwd: root,
    stdio: 'pipe',
  });
};

const expectStructureFailure = (module: SourceModule, rule: ArchitectureRule): void => {
  assert.throws(
    () => validateModuleStructure([module]),
    (error: unknown) => error instanceof Error && error.message.includes(`[${rule}]`),
  );
};

const positiveRootSource =
  "export { compilePipeline, definePipeline } from './definition/index.js';\n" +
  "export { decidePipeline } from './transition/index.js';\n" +
  "export type { ActivateDecision, ActivationCause, AllJoinPolicy, AnyJoinPolicy, BranchCase, BranchDefault, BranchName, BranchNode, BranchPredicate, CandidateKey, CandidateVerdict, CompiledEdge, CompiledEdgeIndexEntry, CompiledEdgeRole, CompiledForkBranch, CompiledForkRegion, CompiledNode, CompiledNodeIndexEntry, CompiledPipeline, ConsensusNode, ConsensusOutcome, ConsensusPolicy, ConsensusRoutes, FactDefinition, FactKey, FactType, ForkBranch, ForkNode, GateResolution, HumanGateNode, HumanGateRoute, JoinNode, JoinOutcome, JoinPolicy, JoinRoutes, JsonScalar, NodeFact, NodeKey, NoopDecision, PipelineDefinition, PipelineFacts, PipelineNode, PipelineValueFact, QuorumConsensusPolicy, ResolutionName, SelectDecision, TaskNode, TaskOutcome, TaskRoutes, TerminalDecision, TerminalNode, ThresholdConsensusPolicy, ThresholdJoinPolicy, UnanimousConsensusPolicy, WaitDecision, WaitReason } from './spec/index.js';\n" +
  "export type { DecisionFault, DecisionFaultCode, DefinitionFault, DefinitionFaultCode, PipelineCompilation, PipelineDecision, RejectDecision } from './errors/index.js';\n";

const positiveGraph: readonly SourceModule[] = [
  {
    path: 'src/index.ts',
    source: positiveRootSource,
  },
  {
    path: 'src/spec/pipeline-definition.ts',
    source: 'export interface PipelineDefinition { readonly entry: string }\n',
  },
  {
    path: 'src/spec/index.ts',
    source: "export type { PipelineDefinition } from './pipeline-definition.js';\n",
  },
  {
    path: 'src/policy/pipeline-limits.ts',
    source: 'export const PIPELINE_LIMITS = { nodes: 1000 } as const;\n',
  },
  {
    path: 'src/policy/index.ts',
    source: "export { PIPELINE_LIMITS } from './pipeline-limits.js';\n",
  },
  {
    path: 'src/errors/pipeline-fault.ts',
    source:
      "import type { PIPELINE_LIMITS } from '../policy/index.js';\nimport type { PipelineDefinition } from '../spec/index.js';\nexport interface PipelineFault { readonly definition?: PipelineDefinition; readonly limits?: typeof PIPELINE_LIMITS }\n",
  },
  {
    path: 'src/errors/index.ts',
    source: "export type { PipelineFault } from './pipeline-fault.js';\n",
  },
  {
    path: 'src/graph/read-edges.ts',
    source:
      "import type { PipelineFault } from '../errors/index.js';\nimport { PIPELINE_LIMITS } from '../policy/index.js';\nimport type { PipelineDefinition } from '../spec/index.js';\nexport const readEdges = (value: PipelineDefinition, fault?: PipelineFault): PipelineDefinition => (PIPELINE_LIMITS.nodes > 0 || fault ? value : value);\n",
  },
  {
    path: 'src/graph/index.ts',
    source: "export { readEdges } from './read-edges.js';\n",
  },
  {
    path: 'src/definition/compile-pipeline.ts',
    source:
      "import type { PipelineFault } from '../errors/index.js';\nimport { readEdges } from '../graph/index.js';\nimport { PIPELINE_LIMITS } from '../policy/index.js';\nimport type { PipelineDefinition } from '../spec/index.js';\nexport const compilePipeline = (value: PipelineDefinition, fault?: PipelineFault): PipelineDefinition => (PIPELINE_LIMITS.nodes > 0 ? readEdges(value, fault) : value);\n",
  },
  {
    path: 'src/definition/index.ts',
    source: "export { compilePipeline } from './compile-pipeline.js';\n",
  },
  {
    path: 'src/transition/decide-transition.ts',
    source:
      "import type { PipelineFault } from '../errors/index.js';\nimport { readEdges } from '../graph/index.js';\nimport { PIPELINE_LIMITS } from '../policy/index.js';\nimport type { PipelineDefinition } from '../spec/index.js';\nexport const decideTransition = (value: PipelineDefinition, fault?: PipelineFault): PipelineDefinition => (PIPELINE_LIMITS.nodes > 0 ? readEdges(value, fault) : value);\n",
  },
  {
    path: 'src/transition/index.ts',
    source: "export { decideTransition } from './decide-transition.js';\n",
  },
];

validateModuleStructure(positiveGraph);
validateModuleStructure([
  ...(await collectModules(join(root, 'src'))),
  ...(await collectModules(join(root, 'test'))),
]);
execFileSync(oxlint, ['--config', config, '--deny-warnings', 'src', 'test'], {
  cwd: root,
  stdio: 'pipe',
});

const structuralProbes: readonly (readonly [SourceModule, ArchitectureRule])[] = [
  [
    {
      path: 'src/graph/reverse-definition.ts',
      source:
        "import type { Compiled } from '../definition/index.js';\nexport type Reverse = Compiled;\n",
    },
    'layer-dependency',
  ],
  [
    {
      path: 'src/transition/reverse-definition.ts',
      source:
        "import type { Compiled } from '../definition/index.js';\nexport type Reverse = Compiled;\n",
    },
    'layer-dependency',
  ],
  [
    {
      path: 'src/graph/missing-js.ts',
      source:
        "import type { PipelineDefinition } from '../spec/index';\nexport type Value = PipelineDefinition;\n",
    },
    'relative-js-suffix',
  ],
  [
    {
      path: 'src/policy/multiple.ts',
      source: 'export const first = true;\nexport const second = true;\n',
    },
    'one-export-per-leaf',
  ],
  [
    {
      path: 'src/graph/index.ts',
      source: "export * from './read-edges.js';\n",
    },
    'explicit-barrel-exports',
  ],
  [
    {
      path: 'src/spec/runtime-value.ts',
      source: 'export const runtimeValue = true;\n',
    },
    'type-only-layer',
  ],
  [
    {
      path: 'src/graph/internal/read.ts',
      source: "import { readEdges } from '../index.js';\nexport const read = readEdges;\n",
    },
    'own-barrel-import',
  ],
  [
    {
      path: 'src/transition/private-graph.ts',
      source:
        "import { readEdges } from '../graph/read-edges.js';\nexport const decide = readEdges;\n",
    },
    'cross-layer-private-import',
  ],
  [
    {
      path: 'test/unit/private.ts',
      source:
        "import type { Value } from '../../src/spec/value.js';\nexport type TestValue = Value;\n",
    },
    'test-private-import',
  ],
  [
    {
      path: 'src/spec/run.ts',
      source: "import type { Run } from '@revisium/revo-run';\nexport type PipelineRun = Run;\n",
    },
    'forbidden-external-import',
  ],
  [
    {
      path: 'src/spec/reverse.ts',
      source:
        "import type { Decision } from '../transition/index.js';\nexport type Reverse = Decision;\n",
    },
    'layer-dependency',
  ],
  [
    {
      path: 'src/spec/index.ts',
      source: "export { PipelineDefinition } from './pipeline-definition.js';\n",
    },
    'type-only-barrel',
  ],
  [
    {
      path: 'src/runtime/escape.ts',
      source: 'export const escape = true;\n',
    },
    'unknown-production-area',
  ],
  [
    {
      path: 'src/graph/unknown-target.ts',
      source: "import { hidden } from '../runtime/hidden.js';\nexport const value = hidden;\n",
    },
    'unknown-production-area',
  ],
  ...['test', 'scripts', 'dist', 'coverage', '.architecture-probe-bypass'].map(
    (area): readonly [SourceModule, ArchitectureRule] => [
      {
        path: `src/graph/${area.replaceAll('.', '-')}-escape.ts`,
        source: `import { escaped } from '../../${area}/escaped.js';\nexport const value = escaped;\n`,
      },
      'forbidden-production-target',
    ],
  ),
  [
    {
      path: 'src/graph/root-import.ts',
      source: "import * as root from '../index.js';\nexport const value = root;\n",
    },
    'internal-root-import',
  ],
  [
    {
      path: 'test/unit/nested-index.ts',
      source:
        "import { internalEdges } from '../../src/graph/internal/index.js';\nvoid internalEdges;\n",
    },
    'test-private-import',
  ],
  [
    {
      path: 'src/transition/nested-index.ts',
      source:
        "import { internalEdges } from '../graph/internal/index.js';\nexport const decide = internalEdges;\n",
    },
    'cross-layer-private-import',
  ],
  [
    {
      path: 'src/index.ts',
      source: positiveRootSource.replace(', definePipeline', ''),
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: `${positiveRootSource}export type { Leaked } from './spec/index.js';\n`,
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: positiveRootSource.replace(
        'export { compilePipeline, definePipeline }',
        'export type { compilePipeline, definePipeline }',
      ),
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: "export * from './spec/index.js';\n",
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: "export { default } from './definition/index.js';\n",
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: 'export const definePipeline = true;\n',
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: positiveRootSource.replace(
        "'./definition/index.js'",
        "'./definition/define-pipeline.js'",
      ),
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: `${positiveRootSource}export { PIPELINE_LIMITS } from './policy/index.js';\n`,
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: `${positiveRootSource}export { topologicalSort } from './graph/index.js';\n`,
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: positiveRootSource.replace('compilePipeline', 'compilePipeline as compile'),
    },
    'root-public-api',
  ],
];

for (const [module, rule] of structuralProbes) {
  expectStructureFailure(module, rule);
}

const probeRoot = await mkdtemp(join(root, '.architecture-probe-'));
try {
  const forbidden = join(probeRoot, 'src/graph/forbidden.ts');
  await mkdir(dirname(forbidden), { recursive: true });
  await writeFile(
    forbidden,
    "import type { Run } from '@revisium/revo-run';\nexport type Value = Run;\n",
  );
  expectLintFailure([relative(root, forbidden)], 'no-restricted-imports');

  const allowedBarrel = join(probeRoot, 'test/allowed-barrel.ts');
  const specBarrel = join(probeRoot, 'src/spec/index.ts');
  await mkdir(dirname(allowedBarrel), { recursive: true });
  await mkdir(dirname(specBarrel), { recursive: true });
  await writeFile(specBarrel, 'export {};\n');
  await writeFile(
    allowedBarrel,
    "import type * as Spec from '../src/spec/index.js';\nexport type PublicSpec = typeof Spec;\n",
  );
  runArchitectureLint([relative(root, allowedBarrel)]);

  const forbiddenTestExternal = join(probeRoot, 'test/forbidden-external.ts');
  await writeFile(
    forbiddenTestExternal,
    "import type { Run } from '@revisium/revo-run';\nexport type ForbiddenRun = Run;\n",
  );
  expectLintFailure([relative(root, forbiddenTestExternal)], 'no-restricted-imports');

  const privateImport = join(probeRoot, 'test/private.ts');
  await mkdir(dirname(privateImport), { recursive: true });
  await writeFile(
    privateImport,
    "import type { Value } from '../src/spec/value.js';\nexport type TestValue = Value;\n",
  );
  expectLintFailure([relative(root, privateImport)], 'no-restricted-imports');

  const cycleA = join(probeRoot, 'src/cycle/a.ts');
  const cycleB = join(probeRoot, 'src/cycle/b.ts');
  await mkdir(dirname(cycleA), { recursive: true });
  await writeFile(
    cycleA,
    "import type { B } from './b.js';\nexport interface A { readonly b: B }\n",
  );
  await writeFile(
    cycleB,
    "import type { A } from './a.js';\nexport interface B { readonly a: A }\n",
  );
  expectLintFailure([relative(root, cycleA), relative(root, cycleB)], 'import(no-cycle)');
} finally {
  await rm(probeRoot, { recursive: true, force: true });
  assert.deepEqual(
    (await readdir(root)).filter((entry) => entry.startsWith('.architecture-probe-')),
    [],
    'Architecture verification must leave no probe directory behind.',
  );
}

console.log('Architecture validation passed (positive graph and exact negative probes).');
