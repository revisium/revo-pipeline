import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

import { validateGraphKernelFlow } from './architecture/validate-graph-kernel-flow.js';
import {
  validateModuleStructure,
  type ArchitectureRule,
  type SourceModule,
} from './architecture/validate-module-structure.js';
import {
  sourceMetricScope,
  validateSourceMetrics,
} from './architecture/validate-source-metrics.js';

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
  "export { decidePipeline, decodeCompiledPipeline } from './transition/index.js';\n" +
  "export type { ActivateDecision, ActivationCause, AllJoinPolicy, AnyJoinPolicy, BranchCase, BranchDefault, BranchName, BranchNode, BranchPredicate, CandidateKey, CandidateVerdict, CompiledEdge, CompiledEdgeIndexEntry, CompiledEdgeRole, CompiledForkBranch, CompiledForkRegion, CompiledNode, CompiledNodeIndexEntry, CompiledPipeline, ConsensusNode, ConsensusOutcome, ConsensusPolicy, ConsensusRoutes, FactDefinition, FactKey, FactType, ForkBranch, ForkNode, GateResolution, HumanGateNode, HumanGateRoute, JoinNode, JoinOutcome, JoinPolicy, JoinRoutes, JsonScalar, NodeFact, NodeKey, NoopDecision, PipelineDefinition, PipelineFacts, PipelineNode, PipelineValueFact, QuorumConsensusPolicy, ResolutionName, SelectDecision, TaskNode, TaskOutcome, TaskRoutes, TerminalDecision, TerminalNode, ThresholdConsensusPolicy, ThresholdJoinPolicy, UnanimousConsensusPolicy, WaitDecision, WaitReason } from './spec/index.js';\n" +
  "export type { CompiledPipelineDecoding, DecodeFault, DecodeFaultCode, DecisionFault, DecisionFaultCode, DefinitionFault, DefinitionFaultCode, PipelineCompilation, PipelineDecision, RejectDecision } from './errors/index.js';\n";

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
const sourceModules = await collectModules(join(root, 'src'));
const testModules = await collectModules(join(root, 'test'));
const architectureModules = await collectModules(join(root, 'scripts/architecture'));
validateModuleStructure([...sourceModules, ...testModules, ...architectureModules]);
validateSourceMetrics(sourceModules, [
  ...sourceMetricScope(sourceModules, 'PR4a'),
  ...sourceMetricScope(sourceModules, 'PR4c'),
]);
assert.deepEqual(validateGraphKernelFlow(root), []);
execFileSync(oxlint, ['--config', config, '--deny-warnings', 'src', 'test'], {
  cwd: root,
  stdio: 'pipe',
});

const sourceOf = (path: string): string => {
  const source = sourceModules.find((module) => module.path === path)?.source;
  if (source === undefined) {
    throw new Error(`Missing required source module: ${path}`);
  }
  return source;
};
const sourceTokens = (source: string): string =>
  source.replaceAll(/\s/gu, '').replaceAll(',}', '}');

const graphModulePaths = sourceModules
  .map((module) => module.path)
  .filter((path) => path.startsWith('src/graph/'))
  .sort();
assert.deepEqual(graphModulePaths, [
  'src/graph/barrier-region-ownership.ts',
  'src/graph/barrier-region-query.ts',
  'src/graph/build-graph-kernel.ts',
  'src/graph/collect-barrier-region-ownership.ts',
  'src/graph/graph-kernel-build.ts',
  'src/graph/graph-kernel-input.ts',
  'src/graph/graph-kernel.ts',
  'src/graph/graph-operation-kind.ts',
  'src/graph/graph-operation-sink.ts',
  'src/graph/index.ts',
  'src/graph/reachable-node-offsets.ts',
  'src/graph/reverse-reachable-node-offsets.ts',
  'src/graph/topological-order.ts',
]);

const definitionModulePaths = sourceModules
  .map((module) => module.path)
  .filter((path) => path.startsWith('src/definition/'))
  .sort();
assert.deepEqual(
  definitionModulePaths,
  [
    'src/definition/compilation/assemble-compiled-pipeline.ts',
    'src/definition/compilation/classify-fork-regions.ts',
    'src/definition/compilation/normalize-pipeline-node.ts',
    'src/definition/compilation/preflight-fork-regions.ts',
    'src/definition/compilation/project-pipeline-edges.ts',
    'src/definition/compilation/validate-definition-graph.ts',
    'src/definition/compile-pipeline.ts',
    'src/definition/contracts/compiler-semantic-graph.ts',
    'src/definition/contracts/definition-validation-result.ts',
    'src/definition/define-pipeline.ts',
    'src/definition/index.ts',
    'src/definition/validation/definition-validation-context.ts',
    'src/definition/validation/validate-branch-node.ts',
    'src/definition/validation/validate-consensus-node.ts',
    'src/definition/validation/validate-definition.ts',
    'src/definition/validation/validate-facts.ts',
    'src/definition/validation/validate-fork-node.ts',
    'src/definition/validation/validate-human-gate-node.ts',
    'src/definition/validation/validate-join-node.ts',
    'src/definition/validation/validate-pipeline-nodes.ts',
  ],
  'Definition must retain the exact approved private leaf map.',
);

const definitionDependencies = new Map<string, readonly string[]>([
  [
    'src/definition/compile-pipeline.ts',
    [
      './compilation/assemble-compiled-pipeline.js',
      './compilation/classify-fork-regions.js',
      './compilation/normalize-pipeline-node.js',
      './compilation/preflight-fork-regions.js',
      './compilation/project-pipeline-edges.js',
      './compilation/validate-definition-graph.js',
      './validation/validate-definition.js',
    ],
  ],
  [
    'src/definition/compilation/assemble-compiled-pipeline.ts',
    ['../contracts/compiler-semantic-graph.js'],
  ],
  [
    'src/definition/compilation/classify-fork-regions.ts',
    [
      '../contracts/compiler-semantic-graph.js',
      '../contracts/definition-validation-result.js',
      './preflight-fork-regions.js',
    ],
  ],
  ['src/definition/compilation/normalize-pipeline-node.ts', []],
  [
    'src/definition/compilation/preflight-fork-regions.ts',
    ['../contracts/definition-validation-result.js'],
  ],
  [
    'src/definition/compilation/project-pipeline-edges.ts',
    ['../contracts/compiler-semantic-graph.js'],
  ],
  [
    'src/definition/compilation/validate-definition-graph.ts',
    [
      '../contracts/compiler-semantic-graph.js',
      '../contracts/definition-validation-result.js',
      './preflight-fork-regions.js',
    ],
  ],
  ['src/definition/contracts/compiler-semantic-graph.ts', []],
  ['src/definition/contracts/definition-validation-result.ts', []],
  ['src/definition/define-pipeline.ts', []],
  [
    'src/definition/validation/validate-definition.ts',
    [
      '../contracts/definition-validation-result.js',
      './definition-validation-context.js',
      './validate-facts.js',
      './validate-pipeline-nodes.js',
    ],
  ],
  ['src/definition/validation/definition-validation-context.ts', []],
  [
    'src/definition/validation/validate-pipeline-nodes.ts',
    [
      './definition-validation-context.js',
      './validate-branch-node.js',
      './validate-consensus-node.js',
      './validate-fork-node.js',
      './validate-human-gate-node.js',
      './validate-join-node.js',
    ],
  ],
  ...[
    'validate-branch-node',
    'validate-consensus-node',
    'validate-facts',
    'validate-fork-node',
    'validate-human-gate-node',
    'validate-join-node',
  ].map(
    (name) =>
      [`src/definition/validation/${name}.ts`, ['./definition-validation-context.js']] as const,
  ),
]);
for (const [path, expected] of definitionDependencies) {
  const dependencies = [...sourceOf(path).matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/gu)]
    .map((match) => match[1]!)
    .filter(
      (specifier) =>
        !specifier.startsWith('../..') &&
        !/^\.\.\/(?:errors|graph|policy|spec)\/index\.js$/u.test(specifier),
    )
    .sort();
  assert.deepEqual(dependencies, [...expected].sort(), `Definition DAG drift: ${path}`);
}

const compiledIntegrityPaths = sourceModules
  .map((module) => module.path)
  .filter(
    (path) =>
      path.startsWith('src/transition/compiled/') ||
      path === 'src/transition/decode-compiled-pipeline.ts' ||
      path === 'src/transition/inspect-compiled-pipeline.ts',
  )
  .sort();
assert.deepEqual(
  compiledIntegrityPaths,
  [
    'src/transition/compiled/compare-serialized-graph.ts',
    'src/transition/compiled/compiled-capture-limit.ts',
    'src/transition/compiled/compiled-inspection-fault-collector.ts',
    'src/transition/compiled/compiled-inspection-fault.ts',
    'src/transition/compiled/compiled-inspection.ts',
    'src/transition/compiled/derive-expected-compiled-semantics.ts',
    'src/transition/compiled/expected-compiled-semantics.ts',
    'src/transition/compiled/inspect-compiled-branch-fallback.ts',
    'src/transition/compiled/inspect-compiled-branch-schema.ts',
    'src/transition/compiled/inspect-compiled-edges.ts',
    'src/transition/compiled/inspect-compiled-facts.ts',
    'src/transition/compiled/inspect-compiled-indexes.ts',
    'src/transition/compiled/inspect-compiled-members.ts',
    'src/transition/compiled/inspect-compiled-node-members.ts',
    'src/transition/compiled/inspect-compiled-node-policy.ts',
    'src/transition/compiled/inspect-compiled-node-routes.ts',
    'src/transition/compiled/inspect-compiled-outcomes.ts',
    'src/transition/compiled/inspect-compiled-regions.ts',
    'src/transition/compiled/inspect-compiled-root-members.ts',
    'src/transition/compiled/snapshot-compiled-input.ts',
    'src/transition/compiled/verify-serialized-indexes.ts',
    'src/transition/compiled/verify-serialized-topology.ts',
    'src/transition/decode-compiled-pipeline.ts',
    'src/transition/inspect-compiled-pipeline.ts',
  ],
  'Compiled integrity must retain the exact approved private leaf map.',
);

const compiledIntegrityDependencies = new Map<string, readonly string[]>([
  ['src/transition/compiled/compare-serialized-graph.ts', ['./expected-compiled-semantics.js']],
  [
    'src/transition/compiled/derive-expected-compiled-semantics.ts',
    ['./expected-compiled-semantics.js'],
  ],
  ['src/transition/compiled/expected-compiled-semantics.ts', []],
  [
    'src/transition/compiled/inspect-compiled-members.ts',
    [
      './compiled-inspection-fault-collector.js',
      './inspect-compiled-edges.js',
      './inspect-compiled-facts.js',
      './inspect-compiled-indexes.js',
      './inspect-compiled-node-members.js',
      './inspect-compiled-regions.js',
      './inspect-compiled-root-members.js',
    ],
  ],
  [
    'src/transition/compiled/inspect-compiled-branch-fallback.ts',
    ['./compiled-inspection-fault-collector.js'],
  ],
  [
    'src/transition/compiled/inspect-compiled-indexes.ts',
    ['./compiled-inspection-fault-collector.js'],
  ],
  [
    'src/transition/compiled/inspect-compiled-node-members.ts',
    [
      './compiled-inspection-fault-collector.js',
      './inspect-compiled-node-policy.js',
      './inspect-compiled-node-routes.js',
      './inspect-compiled-outcomes.js',
    ],
  ],
  [
    'src/transition/compiled/inspect-compiled-branch-schema.ts',
    ['./compiled-inspection-fault-collector.js', './inspect-compiled-branch-fallback.js'],
  ],
  [
    'src/transition/compiled/inspect-compiled-edges.ts',
    ['./compiled-inspection-fault-collector.js'],
  ],
  [
    'src/transition/compiled/inspect-compiled-facts.ts',
    ['./compiled-inspection-fault-collector.js'],
  ],
  [
    'src/transition/compiled/inspect-compiled-node-policy.ts',
    ['./compiled-inspection-fault-collector.js'],
  ],
  [
    'src/transition/compiled/inspect-compiled-node-routes.ts',
    ['./compiled-inspection-fault-collector.js', './inspect-compiled-branch-schema.js'],
  ],
  [
    'src/transition/compiled/inspect-compiled-outcomes.ts',
    ['./compiled-inspection-fault-collector.js'],
  ],
  [
    'src/transition/compiled/inspect-compiled-regions.ts',
    ['./compiled-inspection-fault-collector.js'],
  ],
  [
    'src/transition/compiled/inspect-compiled-root-members.ts',
    ['./compiled-inspection-fault-collector.js'],
  ],
  [
    'src/transition/compiled/compiled-inspection-fault-collector.ts',
    ['./compiled-inspection-fault.js'],
  ],
  ['src/transition/compiled/compiled-inspection-fault.ts', []],
  ['src/transition/compiled/compiled-inspection.ts', ['./compiled-inspection-fault.js']],
  ['src/transition/compiled/compiled-capture-limit.ts', []],
  [
    'src/transition/compiled/snapshot-compiled-input.ts',
    ['./compiled-capture-limit.js', './compiled-inspection-fault-collector.js'],
  ],
  [
    'src/transition/inspect-compiled-pipeline.ts',
    [
      './compiled/compiled-inspection-fault-collector.js',
      './compiled/compiled-inspection.js',
      './compiled/compare-serialized-graph.js',
      './compiled/derive-expected-compiled-semantics.js',
      './compiled/inspect-compiled-members.js',
      './compiled/snapshot-compiled-input.js',
      './compiled/verify-serialized-indexes.js',
      './compiled/verify-serialized-topology.js',
    ],
  ],
  ['src/transition/compiled/verify-serialized-indexes.ts', []],
  ['src/transition/compiled/verify-serialized-topology.ts', []],
  ['src/transition/decode-compiled-pipeline.ts', ['./inspect-compiled-pipeline.js']],
]);
for (const [path, expected] of compiledIntegrityDependencies) {
  const dependencies = [...sourceOf(path).matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/gu)]
    .map((match) => match[1]!)
    .filter(
      (specifier) =>
        !specifier.startsWith('../..') &&
        !/^\.\.\/(?:errors|graph|policy|spec)\/index\.js$/u.test(specifier),
    )
    .sort();
  assert.deepEqual(dependencies, [...expected].sort(), `Compiled integrity DAG drift: ${path}`);
}
assert.equal(
  sourceModules.some((module) => module.path === 'src/transition/compiled/index.ts'),
  false,
  'Compiled integrity must not add a nested barrel.',
);
const decisionLeafPaths = sourceModules
  .map((module) => module.path)
  .filter(
    (path) =>
      path === 'src/transition/decide-pipeline.ts' ||
      /^src\/transition\/(?:context|facts|evaluation)\/.+\.ts$/u.test(path),
  )
  .sort();
assert.deepEqual(decisionLeafPaths, [
  'src/transition/context/build-decision-context.ts',
  'src/transition/context/decision-context.ts',
  'src/transition/decide-pipeline.ts',
  'src/transition/evaluation/find-first-action.ts',
  'src/transition/evaluation/find-first-wait.ts',
  'src/transition/evaluation/find-reached-terminals.ts',
  'src/transition/evaluation/select-branch.ts',
  'src/transition/evaluation/select-consensus.ts',
  'src/transition/evaluation/select-fork.ts',
  'src/transition/evaluation/select-human-gate.ts',
  'src/transition/evaluation/select-join.ts',
  'src/transition/evaluation/select-node.ts',
  'src/transition/evaluation/selection.ts',
  'src/transition/evaluation/validate-fact-causality.ts',
  'src/transition/facts/decision-fault-collector.ts',
  'src/transition/facts/validate-candidate-verdicts.ts',
  'src/transition/facts/validate-gate-resolutions.ts',
  'src/transition/facts/validate-node-facts.ts',
  'src/transition/facts/validate-pipeline-facts.ts',
  'src/transition/facts/validate-value-facts.ts',
  'src/transition/facts/validated-facts.ts',
]);
for (const nestedBarrel of [
  'src/transition/context/index.ts',
  'src/transition/facts/index.ts',
  'src/transition/evaluation/index.ts',
]) {
  assert.equal(
    sourceModules.some((module) => module.path === nestedBarrel),
    false,
    `Decision decomposition must not add nested barrel: ${nestedBarrel}`,
  );
}
const decisionDependencies = new Map<string, readonly string[]>([
  [
    'src/transition/decide-pipeline.ts',
    [
      './inspect-compiled-pipeline.js',
      './context/build-decision-context.js',
      './evaluation/find-first-action.js',
      './evaluation/find-first-wait.js',
      './evaluation/find-reached-terminals.js',
      './evaluation/validate-fact-causality.js',
      './facts/decision-fault-collector.js',
      './facts/validate-pipeline-facts.js',
    ],
  ],
  [
    'src/transition/context/build-decision-context.ts',
    ['../compiled/compiled-inspection.js', './decision-context.js'],
  ],
  ['src/transition/context/decision-context.ts', ['../compiled/compiled-inspection.js']],
  [
    'src/transition/evaluation/find-first-action.ts',
    ['../context/decision-context.js', '../facts/validated-facts.js', './select-node.js'],
  ],
  [
    'src/transition/evaluation/find-first-wait.ts',
    ['../context/decision-context.js', '../facts/validated-facts.js', './select-node.js'],
  ],
  [
    'src/transition/evaluation/find-reached-terminals.ts',
    ['../context/decision-context.js', '../facts/validated-facts.js'],
  ],
  ['src/transition/evaluation/select-branch.ts', ['../facts/validated-facts.js', './selection.js']],
  [
    'src/transition/evaluation/select-consensus.ts',
    ['../context/decision-context.js', '../facts/validated-facts.js', './selection.js'],
  ],
  [
    'src/transition/evaluation/select-fork.ts',
    ['../context/decision-context.js', '../facts/validated-facts.js', './selection.js'],
  ],
  [
    'src/transition/evaluation/select-human-gate.ts',
    ['../context/decision-context.js', '../facts/validated-facts.js', './selection.js'],
  ],
  [
    'src/transition/evaluation/select-join.ts',
    ['../context/decision-context.js', '../facts/validated-facts.js', './selection.js'],
  ],
  [
    'src/transition/evaluation/select-node.ts',
    [
      '../context/decision-context.js',
      '../facts/validated-facts.js',
      './select-branch.js',
      './select-consensus.js',
      './select-fork.js',
      './select-human-gate.js',
      './select-join.js',
      './selection.js',
    ],
  ],
  ['src/transition/evaluation/selection.ts', []],
  [
    'src/transition/evaluation/validate-fact-causality.ts',
    [
      '../context/decision-context.js',
      '../facts/decision-fault-collector.js',
      '../facts/validated-facts.js',
      './select-node.js',
    ],
  ],
  ['src/transition/facts/decision-fault-collector.ts', []],
  [
    'src/transition/facts/validate-candidate-verdicts.ts',
    ['../context/decision-context.js', './decision-fault-collector.js'],
  ],
  [
    'src/transition/facts/validate-gate-resolutions.ts',
    ['../context/decision-context.js', './decision-fault-collector.js'],
  ],
  [
    'src/transition/facts/validate-node-facts.ts',
    ['../context/decision-context.js', './decision-fault-collector.js'],
  ],
  [
    'src/transition/facts/validate-pipeline-facts.ts',
    [
      '../context/decision-context.js',
      './decision-fault-collector.js',
      './validate-candidate-verdicts.js',
      './validate-gate-resolutions.js',
      './validate-node-facts.js',
      './validate-value-facts.js',
      './validated-facts.js',
    ],
  ],
  [
    'src/transition/facts/validate-value-facts.ts',
    ['../context/decision-context.js', './decision-fault-collector.js'],
  ],
  ['src/transition/facts/validated-facts.ts', []],
]);
for (const [path, expected] of decisionDependencies) {
  assert.doesNotMatch(
    sourceOf(path),
    /\bfrom\s+['"](?:\.\.\/)+(?:definition|graph)\/(?:index\.js|[^'"]+)['"]/u,
    `Decision private leaf must not import graph or definition: ${path}`,
  );
  const dependencies = [...sourceOf(path).matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/gu)]
    .map((match) => match[1]!)
    .filter(
      (specifier) =>
        !specifier.startsWith('../..') &&
        !/^\.\.\/(?:errors|graph|policy|spec)\/index\.js$/u.test(specifier),
    )
    .sort();
  assert.deepEqual(dependencies, [...expected].sort(), `Decision DAG drift: ${path}`);
}
assert.equal(
  sourceTokens(sourceOf('src/definition/index.ts')),
  sourceTokens(
    "export { compilePipeline } from './compile-pipeline.js';\n" +
      "export { definePipeline } from './define-pipeline.js';\n",
  ),
  'Definition barrel must expose only its two approved public values.',
);
assert.equal(
  sourceTokens(sourceOf('src/transition/index.ts')),
  sourceTokens(
    "export { decidePipeline } from './decide-pipeline.js';\n" +
      "export { decodeCompiledPipeline } from './decode-compiled-pipeline.js';\n",
  ),
  'Transition barrel must not leak private compiled-integrity leaves.',
);
assert.equal(
  sourceTokens(sourceOf('src/graph/index.ts')),
  sourceTokens(
    "export { buildGraphKernel } from './build-graph-kernel.js';\n" +
      "export { collectBarrierRegionOwnership } from './collect-barrier-region-ownership.js';\n" +
      "export { reachableNodeOffsets } from './reachable-node-offsets.js';\n" +
      "export { reverseReachableNodeOffsets } from './reverse-reachable-node-offsets.js';\n" +
      "export { topologicalOrder } from './topological-order.js';\n" +
      "export type { BarrierRegionOwnership } from './barrier-region-ownership.js';\n" +
      "export type { BarrierRegionQuery } from './barrier-region-query.js';\n" +
      "export type { GraphKernelBuild } from './graph-kernel-build.js';\n" +
      "export type { GraphKernelInput } from './graph-kernel-input.js';\n" +
      "export type { GraphKernel } from './graph-kernel.js';\n" +
      "export type { GraphOperationKind } from './graph-operation-kind.js';\n" +
      "export type { GraphOperationSink } from './graph-operation-sink.js';\n",
  ),
  'Graph barrel must retain its exact private allowlist.',
);

const productionOutsideGraph = sourceModules.filter(
  (module) => !module.path.startsWith('src/graph/'),
);
for (const module of productionOutsideGraph) {
  assert.doesNotMatch(
    module.source,
    /\bGraphOperation(?:Kind|Sink)\b/u,
    `Production instrumentation leaked outside graph: ${module.path}`,
  );
}
assert.doesNotMatch(
  sourceOf('src/transition/decide-pipeline.ts'),
  /\bbuildGraphKernel\b/u,
  'Evaluation must receive the validated kernel rather than build a replacement.',
);
assert.equal(
  (
    sourceOf('src/definition/compilation/validate-definition-graph.ts').match(
      /\bbuildGraphKernel\s*\(/gu,
    ) ?? []
  ).length,
  1,
  'Compiler must build one canonical graph kernel.',
);
assert.equal(
  (sourceOf('src/transition/inspect-compiled-pipeline.ts').match(/\bbuildGraphKernel\s*\(/gu) ?? [])
    .length,
  1,
  'Hostile validation must build one post-equality graph kernel.',
);

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
