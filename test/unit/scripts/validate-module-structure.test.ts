import { expect, test } from 'vitest';

import {
  validateModuleStructure,
  type ArchitectureRule,
  type SourceModule,
} from '../../../scripts/architecture/validate-module-structure.js';

const expectViolation = (module: SourceModule, rule: ArchitectureRule): void => {
  expect(() => validateModuleStructure([module])).toThrowError(`[${rule}]`);
};

const validRootSource =
  "export { compilePipeline, definePipeline } from './definition/index.js';\n" +
  "export { decidePipeline } from './transition/index.js';\n" +
  "export type { ActivateDecision, ActivationCause, AllJoinPolicy, AnyJoinPolicy, BranchCase, BranchDefault, BranchName, BranchNode, BranchPredicate, CandidateKey, CandidateVerdict, CompiledEdge, CompiledEdgeIndexEntry, CompiledEdgeRole, CompiledForkBranch, CompiledForkRegion, CompiledNode, CompiledNodeIndexEntry, CompiledPipeline, ConsensusNode, ConsensusOutcome, ConsensusPolicy, ConsensusRoutes, FactDefinition, FactKey, FactType, ForkBranch, ForkNode, GateResolution, HumanGateNode, HumanGateRoute, JoinNode, JoinOutcome, JoinPolicy, JoinRoutes, JsonScalar, NodeFact, NodeKey, NoopDecision, PipelineDefinition, PipelineFacts, PipelineNode, PipelineValueFact, QuorumConsensusPolicy, ResolutionName, SelectDecision, TaskNode, TaskOutcome, TaskRoutes, TerminalDecision, TerminalNode, ThresholdConsensusPolicy, ThresholdJoinPolicy, UnanimousConsensusPolicy, WaitDecision, WaitReason } from './spec/index.js';\n" +
  "export type { DecisionFault, DecisionFaultCode, DefinitionFault, DefinitionFaultCode, PipelineCompilation, PipelineDecision, RejectDecision } from './errors/index.js';\n";

test('accepts the complete layer dependency matrix', () => {
  expect(() =>
    validateModuleStructure([
      {
        path: 'src/spec/facts.ts',
        source: 'export interface PipelineFacts { readonly completed: boolean }\n',
      },
      {
        path: 'src/spec/index.ts',
        source: "export type { PipelineFacts } from './facts.js';\n",
      },
      {
        path: 'src/policy/limits.ts',
        source: 'export const LIMITS = { nodes: 100 } as const;\n',
      },
      {
        path: 'src/policy/index.ts',
        source: "export { LIMITS } from './limits.js';\n",
      },
      {
        path: 'src/errors/fault.ts',
        source:
          "import type { LIMITS } from '../policy/index.js';\nimport type { PipelineFacts } from '../spec/index.js';\nexport interface Fault { readonly facts: PipelineFacts; readonly limits: typeof LIMITS }\n",
      },
      {
        path: 'src/errors/index.ts',
        source: "export type { Fault } from './fault.js';\n",
      },
      {
        path: 'src/graph/edges.ts',
        source:
          "import type { Fault } from '../errors/index.js';\nimport { LIMITS } from '../policy/index.js';\nimport type { PipelineFacts } from '../spec/index.js';\nexport const edges = (facts: PipelineFacts, fault?: Fault): PipelineFacts => (LIMITS.nodes || fault ? facts : facts);\n",
      },
      {
        path: 'src/graph/index.ts',
        source: "export { edges } from './edges.js';\n",
      },
      {
        path: 'src/definition/compile.ts',
        source:
          "import type { Fault } from '../errors/index.js';\nimport { edges } from '../graph/index.js';\nimport { LIMITS } from '../policy/index.js';\nimport type { PipelineFacts } from '../spec/index.js';\nexport const compile = (facts: PipelineFacts, fault?: Fault): PipelineFacts => (LIMITS.nodes ? edges(facts, fault) : facts);\n",
      },
      {
        path: 'src/definition/index.ts',
        source: "export { compile } from './compile.js';\n",
      },
      {
        path: 'src/transition/decide.ts',
        source:
          "import type { Fault } from '../errors/index.js';\nimport { edges } from '../graph/index.js';\nimport { LIMITS } from '../policy/index.js';\nimport type { PipelineFacts } from '../spec/index.js';\nexport const decide = (facts: PipelineFacts, fault?: Fault): PipelineFacts => (LIMITS.nodes ? edges(facts, fault) : facts);\n",
      },
      {
        path: 'src/index.ts',
        source: validRootSource,
      },
    ]),
  ).not.toThrow();
});

test('accepts supported syntax variants without weakening the matrix', () => {
  expect(() => validateModuleStructure([])).not.toThrow();
  expect(() =>
    validateModuleStructure([
      {
        path: 'src/policy/reexport.ts',
        source: "export { LIMIT } from './limit.js';\n",
      },
      {
        path: 'src/policy/default-policy.ts',
        source: 'export default true;\n',
      },
      {
        path: 'src/policy/private-helper.ts',
        source: 'const hidden = true;\nexport const visible = hidden;\n',
      },
      {
        path: 'src/spec/reexport.ts',
        source: "export type { PipelineFacts } from './pipeline-facts.js';\n",
      },
      {
        path: 'src/errors/import-equals.ts',
        source:
          "import type PipelineFacts = require('../spec/index.js');\nexport type PipelineFault = typeof PipelineFacts;\n",
      },
      {
        path: 'src/definition/dynamic.ts',
        source: "export const loadGraph = () => import('../graph/index.js');\n",
      },
      {
        path: 'src/definition/import-type.ts',
        source: "export type GraphModule = import('../graph/index.js');\n",
      },
      {
        path: 'test/unit/external.ts',
        source: "import { test } from 'vitest';\nvoid test;\n",
      },
      {
        path: 'test/unit/root.ts',
        source: "import * as root from '../../src/index.js';\nvoid root;\n",
      },
    ]),
  ).not.toThrow();
});

test.each([
  [
    {
      path: 'src/graph/reverse.ts',
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
      path: 'src/spec/value.ts',
      source: 'export const value = true;\n',
    },
    'type-only-layer',
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
      path: 'src/policy/destructured.ts',
      source: 'export const { first, nested: { second } } = source;\n',
    },
    'one-export-per-leaf',
  ],
  [
    {
      path: 'src/policy/array-destructured.ts',
      source: 'export const [first, , second] = source;\n',
    },
    'one-export-per-leaf',
  ],
  [
    {
      path: 'src/graph/index.ts',
      source: "export * from './edges.js';\n",
    },
    'explicit-barrel-exports',
  ],
  [
    {
      path: 'src/spec/index.ts',
      source: "export { PipelineFacts } from './pipeline-facts.js';\n",
    },
    'type-only-barrel',
  ],
  [
    {
      path: 'src/errors/index.ts',
      source: "export { PipelineFault } from './pipeline-fault.js';\n",
    },
    'type-only-barrel',
  ],
  [
    {
      path: 'src/graph/edges.ts',
      source: "import type { Facts } from '../spec/index';\nexport type EdgeFacts = Facts;\n",
    },
    'relative-js-suffix',
  ],
  [
    {
      path: 'src/graph/edges.ts',
      source: "import { edges } from './index.js';\nexport const allEdges = edges;\n",
    },
    'own-barrel-import',
  ],
  [
    {
      path: 'src/graph/internal/edges.ts',
      source: "import { edges } from '../index.js';\nexport const internalEdges = edges;\n",
    },
    'own-barrel-import',
  ],
  [
    {
      path: 'src/graph/edges.ts',
      source: "import type { Facts } from '../spec/facts.js';\nexport type EdgeFacts = Facts;\n",
    },
    'cross-layer-private-import',
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
      path: 'src/spec/run.ts',
      source: "import type { Run } from '@revisium/revo-run';\nexport type PipelineRun = Run;\n",
    },
    'forbidden-external-import',
  ],
  [
    {
      path: 'src/spec/value-import.ts',
      source:
        "import { PipelineFacts } from './pipeline-facts.js';\nexport type Value = PipelineFacts;\n",
    },
    'type-only-layer',
  ],
  [
    {
      path: 'src/spec/import-equals.ts',
      source:
        "import PipelineFacts = require('./pipeline-facts.js');\nexport type Value = typeof PipelineFacts;\n",
    },
    'type-only-layer',
  ],
  [
    {
      path: 'src/graph/non-literal-dynamic.ts',
      source:
        "const target = '../definition/index.js';\nexport const loadDefinition = () => import(target);\n",
    },
    'relative-js-suffix',
  ],
  [
    {
      path: 'test/unit/private.ts',
      source:
        "import type { Facts } from '../../src/spec/facts.js';\nexport type TestFacts = Facts;\n",
    },
    'test-private-import',
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
  [
    {
      path: 'src/graph/test-import.ts',
      source: "import { fixture } from '../../test/fixture.js';\nexport const value = fixture;\n",
    },
    'forbidden-production-target',
  ],
  [
    {
      path: 'src/graph/script-import.ts',
      source: "import { tool } from '../../scripts/tool.js';\nexport const value = tool;\n",
    },
    'forbidden-production-target',
  ],
  [
    {
      path: 'src/graph/dist-import.ts',
      source: "import { built } from '../../dist/private.js';\nexport const value = built;\n",
    },
    'forbidden-production-target',
  ],
  [
    {
      path: 'src/graph/coverage-import.ts',
      source: "import { report } from '../../coverage/private.js';\nexport const value = report;\n",
    },
    'forbidden-production-target',
  ],
  [
    {
      path: 'src/graph/probe-import.ts',
      source:
        "import { probe } from '../../.architecture-probe-bypass/private.js';\nexport const value = probe;\n",
    },
    'forbidden-production-target',
  ],
  [
    {
      path: 'src/graph/root-import.ts',
      source: "import * as root from '../index.js';\nexport const value = root;\n",
    },
    'internal-root-import',
  ],
  [
    {
      path: 'src/index.ts',
      source: validRootSource.replace(', definePipeline', ''),
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: `${validRootSource}export type { Leaked } from './spec/index.js';\n`,
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: validRootSource.replace(
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
      source: validRootSource.replace(
        "'./definition/index.js'",
        "'./definition/define-pipeline.js'",
      ),
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: `${validRootSource}export { PIPELINE_LIMITS } from './policy/index.js';\n`,
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: `${validRootSource}export { topologicalSort } from './graph/index.js';\n`,
    },
    'root-public-api',
  ],
  [
    {
      path: 'src/index.ts',
      source: validRootSource.replace('compilePipeline', 'compilePipeline as compile'),
    },
    'root-public-api',
  ],
] satisfies readonly (readonly [SourceModule, ArchitectureRule])[])(
  'rejects $1.path with $2',
  (module, rule) => {
    expect.hasAssertions();
    expectViolation(module, rule);
  },
);
