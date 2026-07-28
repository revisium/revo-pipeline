# Fork, join, consensus, and terminal

This reducer scenario has no scalar facts. Join readiness comes only from the two
terminal branch-exit task records.

<!-- package-example:start:fork-join-consensus-terminal -->

```ts
import assert from 'node:assert/strict';
import {
  compilePipeline,
  decodeCompiledPipeline,
  reducePipeline,
  type PipelineSnapshot,
} from '@revisium/revo-pipeline';

const compilation = compilePipeline({
  schemaVersion: 1,
  entry: 'fanout',
  facts: [],
  nodes: [
    {
      kind: 'fork',
      key: 'fanout',
      join: 'joined',
      branches: [
        { name: 'a', entry: 'task-a', exit: 'task-a' },
        { name: 'b', entry: 'task-b', exit: 'task-b' },
      ],
    },
    {
      kind: 'task',
      key: 'task-a',
      outcomes: { completed: 'joined', failed: 'joined', cancelled: 'joined', skipped: 'joined' },
    },
    {
      kind: 'task',
      key: 'task-b',
      outcomes: { completed: 'joined', failed: 'joined', cancelled: 'joined', skipped: 'joined' },
    },
    {
      kind: 'join',
      key: 'joined',
      fork: 'fanout',
      policy: { kind: 'all' },
      outcomes: { completed: 'review', rejected: 'review', insufficient: 'review' },
    },
    {
      kind: 'consensus',
      key: 'review',
      candidates: ['alice', 'bob'],
      policy: { kind: 'unanimous' },
      outcomes: {
        approved: 'published',
        rejected: 'declined',
        insufficient: 'declined',
        tied: 'declined',
      },
    },
    { kind: 'terminal', key: 'published', outcome: 'published' },
    { kind: 'terminal', key: 'declined', outcome: 'declined' },
  ],
});
if (!compilation.ok) {
  throw new Error(compilation.faults.map(({ code, path }) => `${code} ${path}`).join('\n'));
}
const json = JSON.stringify(compilation.pipeline);
const unknownA: unknown = JSON.parse(json);
const unknownB: unknown = JSON.parse(json);
assert.notEqual(unknownA, unknownB);
assert.deepEqual(unknownA, unknownB);
const decodedA = decodeCompiledPipeline(unknownA);
const decodedB = decodeCompiledPipeline(unknownB);
if (!decodedA.ok || !decodedB.ok) {
  throw new Error('Canonical compiled JSON must decode.');
}
assert.notEqual(decodedA.pipeline, decodedB.pipeline);
assert.deepEqual(decodedA.pipeline, decodedB.pipeline);
assert.equal(Object.isFrozen(decodedA.pipeline), true);
const pipeline = decodedA.pipeline;
const initial = (): PipelineSnapshot => ({
  schemaVersion: 1,
  occurrenceKey: 'parallel-example',
  phase: 'uninitialized',
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
  terminal: null,
});
const initialized = reducePipeline(pipeline, initial(), {
  schemaVersion: 1,
  kind: 'init',
  values: [],
});
if (!initialized.ok || initialized.status !== 'waiting') {
  throw new Error('Initialization must settle at the first task wait.');
}
assert.deepEqual(
  initialized.batch.items.map(({ kind }) => kind),
  [
    'initialize',
    'activateNode',
    'completeSelector',
    'activateNode',
    'activateNode',
    'activateNode',
  ],
);
assert.equal(initialized.wait.occurrence.nodeKey, 'task-a');
assert.deepEqual(
  initialized.snapshot.nodes.map(({ occurrence, state }) => [occurrence.nodeKey, state]),
  [
    ['fanout', 'terminal'],
    ['task-a', 'enabled'],
    ['task-b', 'enabled'],
    ['joined', 'enabled'],
  ],
);
assert.deepEqual(
  initialized.batch.items
    .filter(
      (effect) =>
        effect.kind === 'activateNode' &&
        (effect.occurrence.nodeKey === 'task-a' || effect.occurrence.nodeKey === 'task-b'),
    )
    .map((effect) => (effect.kind === 'activateNode' ? effect.fork : null)),
  [
    {
      kind: 'branch',
      forkNodeKey: 'fanout',
      joinNodeKey: 'joined',
      branch: 'a',
      role: 'entryExit',
    },
    {
      kind: 'branch',
      forkNodeKey: 'fanout',
      joinNodeKey: 'joined',
      branch: 'b',
      role: 'entryExit',
    },
  ],
);
const firstCommand = {
  schemaVersion: 1 as const,
  kind: 'taskOutcome' as const,
  occurrence: { occurrenceKey: 'parallel-example', nodeKey: 'task-a' },
  outcome: 'completed' as const,
  values: [],
};
const snapshotA: PipelineSnapshot = JSON.parse(
  JSON.stringify(initialized.snapshot),
) as PipelineSnapshot;
const snapshotB: PipelineSnapshot = JSON.parse(
  JSON.stringify(initialized.snapshot),
) as PipelineSnapshot;
const commandA = structuredClone(firstCommand);
const commandB = structuredClone(firstCommand);
const commandBefore = structuredClone(commandA);
assert.notEqual(snapshotA, snapshotB);
assert.notEqual(commandA, commandB);
const firstA = reducePipeline(pipeline, snapshotA, commandA);
const firstB = reducePipeline(pipeline, snapshotB, commandB);
assert.deepEqual(firstA, firstB);
assert.deepEqual(snapshotA, initialized.snapshot);
assert.deepEqual(commandA, commandBefore);
if (!firstA.ok || firstA.status !== 'waiting') {
  throw new Error('One exit task must leave the other task and join incomplete.');
}
assert.equal(firstA.wait.occurrence.nodeKey, 'task-b');
assert.deepEqual(
  firstA.snapshot.nodes
    .filter(
      ({ occurrence }) =>
        occurrence.nodeKey === 'joined' ||
        occurrence.nodeKey === 'task-a' ||
        occurrence.nodeKey === 'task-b',
    )
    .map(({ occurrence, state }) => [occurrence.nodeKey, state]),
  [
    ['task-a', 'terminal'],
    ['task-b', 'enabled'],
    ['joined', 'enabled'],
  ],
);
const second = reducePipeline(pipeline, firstA.snapshot, {
  schemaVersion: 1,
  kind: 'taskOutcome',
  occurrence: { occurrenceKey: 'parallel-example', nodeKey: 'task-b' },
  outcome: 'completed',
  values: [],
});
if (!second.ok || second.status !== 'waiting') {
  throw new Error('Both exit-task records must advance to consensus waiting.');
}
assert.equal(second.wait.reason, 'consensus-incomplete');
assert.equal(second.wait.occurrence.nodeKey, 'review');
const alice = reducePipeline(pipeline, second.snapshot, {
  schemaVersion: 1,
  kind: 'consensusVerdict',
  occurrence: { occurrenceKey: 'parallel-example', nodeKey: 'review' },
  candidate: 'alice',
  verdict: 'approve',
});
if (!alice.ok || alice.status !== 'waiting') {
  throw new Error('One of two unanimous verdicts must remain incomplete.');
}
const bob = reducePipeline(pipeline, alice.snapshot, {
  schemaVersion: 1,
  kind: 'consensusVerdict',
  occurrence: { occurrenceKey: 'parallel-example', nodeKey: 'review' },
  candidate: 'bob',
  verdict: 'approve',
});
if (!bob.ok || bob.status !== 'terminal') {
  throw new Error('Two approvals must terminate as published.');
}
assert.equal(bob.terminal.outcome, 'published');
assert.deepEqual(
  bob.batch.items.map(({ kind }) => kind),
  ['recordConsensusVerdict', 'completeSelector', 'activateNode', 'terminatePipeline'],
);
```

<!-- package-example:end:fork-join-consensus-terminal -->

The separately allocated reductions above demonstrate deterministic equivalence, not
command replay. Every snapshot value collection remains empty because this definition
declares no scalar facts.
