export const RUNTIME_CONSUMER_SOURCE = `
import assert from 'node:assert/strict';
import {
  compilePipeline,
  decidePipeline,
  decodeCompiledPipeline,
  definePipeline,
  reducePipeline,
} from '@revisium/revo-pipeline';

const assertNever = (value) => {
  throw new Error('Unexpected public union member: ' + String(value));
};
import * as packageEntry from '@revisium/revo-pipeline';

assert.equal(import.meta.resolve('@revisium/revo-pipeline'), '__PACKAGE_ROOT_ENTRY__');
assert.deepEqual(Object.keys(packageEntry).sort(), [
  'compilePipeline',
  'decidePipeline',
  'decodeCompiledPipeline',
  'definePipeline',
  'reducePipeline',
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
const scriptCompilation = compilePipeline(definePipeline({
  schemaVersion: 1,
  entry: 'script',
  facts: [],
  nodes: [
    {
      kind: 'script',
      key: 'script',
      script: { id: 'script:system/packed', version: 1 },
      input: { message: 'packed root' },
      outcomes: {
        completed: 'published',
        failed: 'cancelled',
        cancelled: 'cancelled',
        skipped: 'cancelled',
      },
    },
    { kind: 'terminal', key: 'published', outcome: 'published' },
    { kind: 'terminal', key: 'cancelled', outcome: 'cancelled' },
  ],
}));
assert.equal(scriptCompilation.ok, true);
if (!scriptCompilation.ok) throw new Error('The packed script example must compile.');
assert.deepEqual(scriptCompilation.pipeline.nodes.find(({ key }) => key === 'script'), {
  kind: 'task',
  key: 'script',
  outcomes: {
    completed: 'published',
    failed: 'cancelled',
    cancelled: 'cancelled',
    skipped: 'cancelled',
  },
});
assert.equal(scriptCompilation.template.pipeline, scriptCompilation.pipeline);
assert.deepEqual(scriptCompilation.template.executorRequirements, [
  {
    kind: 'script',
    nodeKey: 'script',
    script: { id: 'script:system/packed', version: 1 },
    input: { message: 'packed root' },
  },
]);
assert.deepEqual(scriptCompilation.template.terminalBindings, [
  { nodeKey: 'cancelled', outcome: 'cancelled' },
  { nodeKey: 'published', outcome: 'published' },
]);
const pipeline = JSON.parse(JSON.stringify(compilation.pipeline));
const decoding = decodeCompiledPipeline(pipeline);
assert.equal(decoding.ok, true);
if (!decoding.ok) throw new Error('The packed example must decode.');
const snapshot = {
  schemaVersion: 1,
  occurrenceKey: 'package-consumer',
  phase: 'uninitialized',
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
  terminal: null,
};
const command = {
  schemaVersion: 1,
  kind: 'init',
  values: [],
};
const initialization = reducePipeline(decoding.pipeline, snapshot, command);
assert.equal(initialization.ok, true);
if (!initialization.ok) throw new Error('The packed example must reduce.');
assert.equal(initialization.application, 'applied');
assert.equal(initialization.status, 'waiting');
assert.equal(initialization.batch.kind, 'atomic');
assert.ok(initialization.batch.items.length > 0);
const emptyFacts = { values: [], nodes: [], candidateVerdicts: [], gateResolutions: [] };
assert.deepEqual(decidePipeline(decoding.pipeline, emptyFacts), {
  kind: 'activate',
  cause: { kind: 'entry' },
  nodeKeys: ['approval'],
});
const unresolvedFacts = {
  ...emptyFacts,
  nodes: [{ key: 'approval', state: 'enabled' }],
};
assert.deepEqual(decidePipeline(decoding.pipeline, unresolvedFacts), {
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
assert.deepEqual(decidePipeline(decoding.pipeline, resolvedFacts), selected);
assert.deepEqual(decidePipeline(decoding.pipeline, resolvedFacts), selected);
const replay = reducePipeline(decoding.pipeline, initialization.snapshot, command);
assert.equal(replay.ok, true);
if (!replay.ok) throw new Error('The packed example replay must reduce.');
assert.equal(replay.application, 'unchanged');
assert.deepEqual(replay.snapshot, initialization.snapshot);
assert.deepEqual(replay.status, initialization.status);
assert.deepEqual(replay.wait, initialization.wait);
assert.deepEqual(replay.batch, { kind: 'atomic', items: [] });
`;

export const PRIVATE_RUNTIME_CONSUMER_SOURCE = `
import '@revisium/revo-pipeline/dist/index.js';
`;

export const TYPE_CONSUMER_SOURCE = `
import {
  compilePipeline,
  decidePipeline,
  decodeCompiledPipeline,
  definePipeline,
  reducePipeline,
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
  type CompiledPipelineDecoding,
  type ConsensusNode,
  type ConsensusOutcome,
  type ConsensusPolicy,
  type ConsensusRoutes,
  type ExecutorRequirement,
  type DecisionFault,
  type DecisionFaultCode,
  type DecodeFault,
  type DecodeFaultCode,
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
  type JsonValue,
  type NodeFact,
  type NodeKey,
  type NoopDecision,
  type PipelineCompilation,
  type PipelineDecision,
  type PipelineDefinition,
  type PipelineExecutionTemplate,
  type PipelineFacts,
  type PipelineNode,
  type PipelineCandidateVerdictRecord,
  type PipelineCommand,
  type PipelineCommandApplication,
  type PipelineEffect,
  type PipelineEffectBatch,
  type PipelineForkRelation,
  type PipelineGateResolutionRecord,
  type PipelineNodeOccurrence,
  type PipelineOccurrenceKey,
  type PipelineReduction,
  type PipelineReductionFault,
  type PipelineReductionFaultCode,
  type PipelineReductionStatus,
  type PipelineRetirement,
  type PipelineSnapshot,
  type PipelineSnapshotNode,
  type PipelineTerminal,
  type PipelineValueRecord,
  type PipelineValueSource,
  type PipelineWait,
  type PipelineValueFact,
  type QuorumConsensusPolicy,
  type RejectDecision,
  type ResolutionName,
  type ScriptIdentity,
  type ScriptNode,
  type SelectDecision,
  type TaskNode,
  type TaskOutcome,
  type TaskRoutes,
  type TerminalBindingTemplate,
  type TerminalDecision,
  type TerminalNode,
  type ThresholdConsensusPolicy,
  type ThresholdJoinPolicy,
  type UnanimousConsensusPolicy,
  type WaitDecision,
  type WaitReason,
} from '@revisium/revo-pipeline';

const assertNever = (value: never): never => {
  throw new Error('Unexpected public union member: ' + String(value));
};

type PublicTypes = readonly [
  JsonScalar, NodeKey, FactKey, CandidateKey, BranchName, ResolutionName, TaskOutcome,
  FactType, FactDefinition, TaskRoutes, BranchPredicate, BranchCase, BranchDefault,
  ForkBranch, AllJoinPolicy, AnyJoinPolicy, ThresholdJoinPolicy, JoinPolicy, JoinOutcome,
  JoinRoutes, UnanimousConsensusPolicy, QuorumConsensusPolicy, ThresholdConsensusPolicy,
  ConsensusPolicy, ConsensusOutcome, ConsensusRoutes, HumanGateRoute, TaskNode, JsonValue,
  ScriptIdentity, ScriptNode, BranchNode,
  ForkNode, JoinNode, ConsensusNode, HumanGateNode, TerminalNode, PipelineNode,
  PipelineDefinition, CompiledNode, CompiledEdgeRole, CompiledEdge, CompiledForkBranch,
  CompiledForkRegion, CompiledNodeIndexEntry, CompiledEdgeIndexEntry, CompiledPipeline,
  ExecutorRequirement, TerminalBindingTemplate, PipelineExecutionTemplate,
  CompiledPipelineDecoding, DecodeFaultCode, DecodeFault,
  DefinitionFaultCode, DefinitionFault, PipelineCompilation, NodeFact, PipelineValueFact,
  CandidateVerdict, GateResolution, PipelineFacts, ActivationCause, WaitReason,
  DecisionFaultCode, DecisionFault, ActivateDecision, SelectDecision, WaitDecision,
  TerminalDecision, NoopDecision, RejectDecision, PipelineDecision,
  PipelineCandidateVerdictRecord, PipelineCommand, PipelineCommandApplication,
  PipelineEffect, PipelineEffectBatch, PipelineForkRelation, PipelineGateResolutionRecord,
  PipelineNodeOccurrence, PipelineOccurrenceKey, PipelineReduction, PipelineReductionFault,
  PipelineReductionFaultCode, PipelineReductionStatus, PipelineRetirement, PipelineSnapshot,
  PipelineSnapshotNode, PipelineTerminal, PipelineValueRecord, PipelineValueSource, PipelineWait,
];
const publicTypeCount: 92 = null as unknown as PublicTypes['length'];

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
if (!compilation.ok) {
  const definitionFault: DefinitionFault | undefined = compilation.faults[0];
  void definitionFault;
} else {
  const decoding: CompiledPipelineDecoding = decodeCompiledPipeline(
    JSON.parse(JSON.stringify(compilation.pipeline)),
  );
  if (!decoding.ok) {
    const decodeFault: DecodeFault | undefined = decoding.faults[0];
    void decodeFault;
  } else {
  const facts: PipelineFacts = {
    values: [],
    nodes: [{ key: 'approval', state: 'enabled' }],
    candidateVerdicts: [],
    gateResolutions: [],
  };
  const decision: PipelineDecision = decidePipeline(decoding.pipeline, facts);
  switch (decision.kind) {
    case 'activate':
      void decision.nodeKeys;
      break;
    case 'select':
      void decision.activate;
      break;
    case 'wait':
      void decision.reason;
      break;
    case 'terminal':
      void decision.outcome;
      break;
    case 'noop':
      void decision.reason;
      break;
    case 'reject':
      void decision.faults;
      break;
    default:
      assertNever(decision);
  }
  const snapshot: PipelineSnapshot = {
    schemaVersion: 1,
    occurrenceKey: 'packed-consumer',
    phase: 'uninitialized',
    values: [],
    nodes: [],
    candidateVerdicts: [],
    gateResolutions: [],
    terminal: null,
  };
  const reduction: PipelineReduction = reducePipeline(decoding.pipeline, snapshot, {
    schemaVersion: 1,
    kind: 'init',
    values: [],
  });
  if (!reduction.ok) {
    const reductionFault: PipelineReductionFault | undefined = reduction.faults[0];
    void reductionFault;
  } else {
    void reduction.application;
    void reduction.snapshot;
    void reduction.batch;
    switch (reduction.status) {
      case 'waiting':
        void reduction.wait;
        break;
      case 'terminal':
        void reduction.terminal;
        break;
      default:
        assertNever(reduction);
    }
  }
  }
}
void publicTypeCount;
void literalEntry;
void literalKind;
`;

export const PRIVATE_TYPE_CONSUMER_SOURCE = `
import type * as PrivateEntry from '@revisium/revo-pipeline/dist/index.js';
export type LeakedPrivateEntry = typeof PrivateEntry;
`;

export const HOST_SHAPED_CONSUMER_SOURCE = `
import {
  compilePipeline,
  decidePipeline,
  decodeCompiledPipeline,
  definePipeline,
  reducePipeline,
  type PipelineCommand,
  type PipelineFacts,
  type PipelineSnapshot,
} from '@revisium/revo-pipeline';

const assertNever = (value: never): never => {
  throw new Error('Unexpected public union member: ' + String(value));
};

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
const compilation = compilePipeline(definition);
if (!compilation.ok) throw new Error('Host-shaped consumer requires a valid definition.');
const input: unknown = JSON.parse(JSON.stringify(compilation.pipeline));
const decoding = decodeCompiledPipeline(input);
if (!decoding.ok) {
  for (const fault of decoding.faults) void fault.code;
  throw new Error('Host-shaped consumer requires decoded compiled data.');
}
const facts: PipelineFacts = {
  values: [],
  nodes: [{ key: 'approval', state: 'enabled' }],
  candidateVerdicts: [],
  gateResolutions: [],
};
const decision = decidePipeline(decoding.pipeline, facts);
switch (decision.kind) {
  case 'activate':
  case 'select':
  case 'wait':
  case 'terminal':
  case 'noop':
    break;
  case 'reject':
    for (const fault of decision.faults) void fault.code;
    break;
  default:
    assertNever(decision);
}
const snapshot: PipelineSnapshot = {
  schemaVersion: 1,
  occurrenceKey: 'host-shaped',
  phase: 'uninitialized',
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
  terminal: null,
};
const command: PipelineCommand = { schemaVersion: 1, kind: 'init', values: [] };
const reduction = reducePipeline(decoding.pipeline, snapshot, command);
if (!reduction.ok) {
  for (const fault of reduction.faults) void fault.code;
} else {
  void reduction.application;
  void reduction.snapshot;
  void reduction.batch;
  switch (reduction.status) {
    case 'waiting':
      void reduction.wait;
      break;
    case 'terminal':
      void reduction.terminal;
      break;
    default:
      assertNever(reduction);
  }
}
`;

export const DEFAULT_TYPE_CONSUMER_SOURCE = `
import pipeline from '@revisium/revo-pipeline';
void pipeline;
`;

export const ALIAS_TYPE_CONSUMER_SOURCE = `
import { createPipeline } from '@revisium/revo-pipeline';
void createPipeline;
`;

export const SUBPATH_TYPE_CONSUMER_SOURCE = `
import { decidePipeline } from '@revisium/revo-pipeline/transition';
void decidePipeline;
`;

export type PermissionFixtureKind =
  | 'permission-read'
  | 'permission-write'
  | 'permission-child'
  | 'permission-worker';

export const permissionFixtureSource = (kind: PermissionFixtureKind): string => {
  const denied = `const denied = (error, permission) => error && error.code === 'ERR_ACCESS_DENIED' && error.permission === permission;\n`;
  if (kind === 'permission-read') {
    return `import { readFileSync } from 'node:fs';\n${denied}try { readFileSync('__OUTSIDE_SENTINEL__'); throw new Error('outside read allowed'); } catch (error) { if (!denied(error, 'FileSystemRead')) throw error; }\n`;
  }
  if (kind === 'permission-write') {
    return `import { writeFileSync } from 'node:fs';\n${denied}for (const target of ['__INSIDE_WRITE__', '__OUTSIDE_SENTINEL__']) { try { writeFileSync(target, 'denied'); throw new Error('write allowed'); } catch (error) { if (!denied(error, 'FileSystemWrite')) throw error; } }\n`;
  }
  if (kind === 'permission-child') {
    return `import { spawnSync } from 'node:child_process';\n${denied}try { spawnSync(process.execPath, ['--version']); throw new Error('child allowed'); } catch (error) { if (!denied(error, 'ChildProcess')) throw error; }\n`;
  }
  return `import { Worker } from 'node:worker_threads';\n${denied}try { new Worker('0', { eval: true }); throw new Error('worker allowed'); } catch (error) { if (!denied(error, 'WorkerThreads')) throw error; }\n`;
};
