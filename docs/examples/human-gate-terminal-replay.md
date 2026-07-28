# Human gate, terminal, and replay

The host authorizes external input before constructing the portable resolution command.

<!-- package-example:start:human-gate-terminal-replay -->

```ts
import assert from 'node:assert/strict';
import { compilePipeline, reducePipeline, type PipelineSnapshot } from '@revisium/revo-pipeline';

const compilation = compilePipeline({
  schemaVersion: 1,
  entry: 'approval',
  facts: [{ key: 'reason', type: 'string' }],
  nodes: [
    {
      kind: 'humanGate',
      key: 'approval',
      subject: 'Approve publication?',
      resolutions: [
        { resolution: 'approved', to: 'published' },
        { resolution: 'rejected', to: 'rejected' },
      ],
    },
    { kind: 'terminal', key: 'published', outcome: 'published' },
    { kind: 'terminal', key: 'rejected', outcome: 'rejected' },
  ],
});
if (!compilation.ok) {
  throw new Error(compilation.faults.map(({ code, path }) => `${code} ${path}`).join('\n'));
}
const pipeline = compilation.pipeline;
const initial: PipelineSnapshot = {
  schemaVersion: 1,
  occurrenceKey: 'gate-example',
  phase: 'uninitialized',
  values: [],
  nodes: [],
  candidateVerdicts: [],
  gateResolutions: [],
  terminal: null,
};
const initialized = reducePipeline(pipeline, initial, {
  schemaVersion: 1,
  kind: 'init',
  values: [],
});
if (
  !initialized.ok ||
  initialized.status !== 'waiting' ||
  initialized.snapshot.phase !== 'active'
) {
  throw new Error('Gate initialization must settle at an active wait.');
}
assert.equal(initialized.wait.reason, 'gate-unresolved');
assert.equal(Object.isFrozen(initialized.snapshot), true);
const resolution = {
  schemaVersion: 1 as const,
  kind: 'humanGateResolution' as const,
  occurrence: { occurrenceKey: 'gate-example', nodeKey: 'approval' },
  resolution: 'approved',
  values: [{ key: 'reason', value: 'reviewed' }],
};
const snapshotA: PipelineSnapshot = JSON.parse(
  JSON.stringify(initialized.snapshot),
) as PipelineSnapshot;
const snapshotB: PipelineSnapshot = JSON.parse(
  JSON.stringify(initialized.snapshot),
) as PipelineSnapshot;
const commandA = structuredClone(resolution);
const commandB = structuredClone(resolution);
const commandBefore = structuredClone(commandA);
assert.notEqual(snapshotA, snapshotB);
assert.notEqual(commandA, commandB);
const resolvedA = reducePipeline(pipeline, snapshotA, commandA);
const resolvedB = reducePipeline(pipeline, snapshotB, commandB);
assert.deepEqual(resolvedA, resolvedB);
assert.deepEqual(snapshotA, initialized.snapshot);
assert.deepEqual(commandA, commandBefore);
if (!resolvedA.ok || resolvedA.status !== 'terminal') {
  throw new Error('The approved gate must terminate as published.');
}
assert.equal(resolvedA.application, 'applied');
assert.equal(resolvedA.terminal.outcome, 'published');
assert.deepEqual(
  resolvedA.batch.items.map(({ kind }) => kind),
  ['resolveHumanGate', 'completeSelector', 'activateNode', 'terminatePipeline'],
);
assert.notEqual(resolvedA.snapshot, snapshotA);
assert.equal(Object.isFrozen(resolvedA), true);
assert.equal(Object.isFrozen(resolvedA.snapshot), true);
assert.equal(Object.isFrozen(resolvedA.batch), true);
const replaySnapshot: PipelineSnapshot = JSON.parse(
  JSON.stringify(resolvedA.snapshot),
) as PipelineSnapshot;
const replayCommand = structuredClone(resolution);
const replaySnapshotBefore = structuredClone(replaySnapshot);
const replayCommandBefore = structuredClone(replayCommand);
const replay = reducePipeline(pipeline, replaySnapshot, replayCommand);
if (!replay.ok || replay.status !== 'terminal') {
  throw new Error('Exact terminal replay must succeed.');
}
assert.deepEqual(replaySnapshot, replaySnapshotBefore);
assert.deepEqual(replayCommand, replayCommandBefore);
assert.equal(replay.application, 'unchanged');
assert.deepEqual(replay.snapshot, resolvedA.snapshot);
assert.deepEqual(replay.terminal, resolvedA.terminal);
assert.deepEqual(replay.batch, { kind: 'atomic', items: [] });
```

<!-- package-example:end:human-gate-terminal-replay -->

The package validates the command’s portable shape, occurrence, target kind, declared
resolution and values, lifecycle, causality, replay/conflict, canonicalization, routing,
and diagnostics. Subject identity, authentication, authorization, inbox, durable
answer/audit storage, concurrent submission handling, notifications, timeout, and retry
remain host-owned.
