# Consumer Example

> [!IMPORTANT]
> This is a Draft, target-only example. The npm package is not published, the root export is intentionally empty, and every
> API name and object shape below is provisional.

This example defines one portable review graph and then evaluates independent fact snapshots. It demonstrates the intended
consumer flow:

```text
define portable data
        |
        v
compile and validate once
        |
        v
read an explicit durable fact snapshot
        |
        v
calculate one pure PipelineDecision
        |
        v
consumer applies the decision atomically
```

The pipeline package owns only definition, compilation, and decision calculation. The illustrative `applyAtomically()`
function belongs to the consumer and is intentionally not implemented here.

## Define and compile

```ts
import { compilePipeline, decidePipeline, definePipeline } from '@revisium/revo-pipeline';

const definition = definePipeline({
  schemaVersion: 1,
  entry: 'prepare',
  nodes: [
    {
      key: 'prepare',
      kind: 'task',
      outcomes: { completed: 'route-review' },
    },
    {
      key: 'route-review',
      kind: 'branch',
      cases: [
        {
          name: 'review-required',
          when: { field: 'reviewRequired', equals: true },
          target: 'review-fork',
        },
      ],
      default: { name: 'skip-review', target: 'approval' },
    },
    {
      key: 'review-fork',
      kind: 'fork',
      branches: [
        { name: 'reviewer-a', entry: 'review-a' },
        { name: 'reviewer-b', entry: 'review-b' },
        { name: 'reviewer-c', entry: 'review-c' },
      ],
      join: 'reviews-finished',
    },
    {
      key: 'review-a',
      kind: 'task',
      outcomes: { completed: 'reviews-finished' },
    },
    {
      key: 'review-b',
      kind: 'task',
      outcomes: { completed: 'reviews-finished' },
    },
    {
      key: 'review-c',
      kind: 'task',
      outcomes: { completed: 'reviews-finished' },
    },
    {
      key: 'reviews-finished',
      kind: 'join',
      fork: 'review-fork',
      policy: { kind: 'all' },
      next: 'review-consensus',
    },
    {
      key: 'review-consensus',
      kind: 'consensus',
      candidates: ['review-a', 'review-b', 'review-c'],
      policy: {
        kind: 'quorum',
        required: 2,
        tie: 'rejected',
      },
      outcomes: {
        accepted: 'approval',
        rejected: 'review-rejected',
      },
    },
    {
      key: 'approval',
      kind: 'humanGate',
      subject: 'Approve the reviewed change',
      resolutions: {
        approved: 'publish',
        rejected: 'cancelled',
      },
    },
    {
      key: 'publish',
      kind: 'task',
      outcomes: { completed: 'published', failed: 'publish-failed' },
    },
    { key: 'published', kind: 'terminal', outcome: 'published' },
    { key: 'review-rejected', kind: 'terminal', outcome: 'review-rejected' },
    { key: 'cancelled', kind: 'terminal', outcome: 'cancelled' },
    { key: 'publish-failed', kind: 'terminal', outcome: 'publish-failed' },
  ],
});

const compilation = compilePipeline(definition);

if (!compilation.ok) {
  for (const fault of compilation.faults) {
    console.error(fault.code, fault.path, fault.message);
  }

  throw new Error('Invalid pipeline definition');
}

const pipeline = compilation.pipeline;
```

`NodeKey` values such as `review-a` are definition-local semantic identities. They are not run ids, database ids, runtime
node-instance ids, attempt ids, idempotency keys, or lease tokens. Compilation copies retained input and produces portable
readonly JSON-compatible data; it does not bind executors, models, profiles, prompts, credentials, or workspaces.

## Decide from independent snapshots

Each call below is independent. The package does not remember earlier calls, update the facts, or apply the returned
decision.

### Branch

After `prepare` completes, the branch reads the explicit `reviewRequired` value. Exactly one declared case or the default
must be selected.

```ts
const branchDecision = decidePipeline(pipeline, {
  values: { reviewRequired: true },
  nodes: [
    { key: 'prepare', state: 'terminal', outcome: 'completed' },
    { key: 'route-review', state: 'active' },
  ],
});

// Representative target result:
// {
//   kind: 'select',
//   nodeKey: 'route-review',
//   outcome: 'review-required',
//   activate: ['review-fork']
// }
```

The predicate is portable data over declared fields. It cannot execute JavaScript, read the environment, call a service,
or inspect stored run rows.

### Fork

When the selected fork is enabled, one decision activates every declared branch entry in stable order.

```ts
const forkDecision = decidePipeline(pipeline, {
  nodes: [{ key: 'review-fork', state: 'enabled' }],
});

// Representative target result:
// {
//   kind: 'activate',
//   nodeKeys: ['review-a', 'review-b', 'review-c']
// }
```

The package does not enqueue tasks or create runtime node instances. A run engine may apply the whole activation set in one
transaction.

### Join

Join readiness is derived from current branch and node facts. There is no mutable counter and no `JoinArrival`.

```ts
const waitingForJoin = decidePipeline(pipeline, {
  nodes: [
    { key: 'review-a', state: 'terminal', outcome: 'completed' },
    { key: 'review-b', state: 'terminal', outcome: 'completed' },
    { key: 'review-c', state: 'active' },
    { key: 'reviews-finished', state: 'enabled' },
  ],
  forkBranches: [
    { forkKey: 'review-fork', branch: 'reviewer-a', condition: 'accepted' },
    { forkKey: 'review-fork', branch: 'reviewer-b', condition: 'accepted' },
    { forkKey: 'review-fork', branch: 'reviewer-c', condition: 'active' },
  ],
});

// Representative target result:
// { kind: 'wait', nodeKey: 'reviews-finished', reason: 'join-incomplete' }

const readyJoin = decidePipeline(pipeline, {
  nodes: [
    { key: 'review-a', state: 'terminal', outcome: 'completed' },
    { key: 'review-b', state: 'terminal', outcome: 'completed' },
    { key: 'review-c', state: 'terminal', outcome: 'completed' },
    { key: 'reviews-finished', state: 'enabled' },
  ],
  forkBranches: [
    { forkKey: 'review-fork', branch: 'reviewer-a', condition: 'accepted' },
    { forkKey: 'review-fork', branch: 'reviewer-b', condition: 'accepted' },
    { forkKey: 'review-fork', branch: 'reviewer-c', condition: 'accepted' },
  ],
});

// Representative target result:
// {
//   kind: 'activate',
//   nodeKeys: ['review-consensus']
// }
```

With an `all` policy, every non-skipped branch must reach its declared accepted terminal condition. `any` and `threshold`
policies use the same explicit-facts model.

### Consensus

Consensus consumes normalized candidate verdict facts. It neither runs reviewers nor chooses which attempt/output becomes
a candidate verdict.

```ts
const consensusDecision = decidePipeline(pipeline, {
  nodes: [{ key: 'review-consensus', state: 'active' }],
  candidateVerdicts: [
    { nodeKey: 'review-consensus', candidate: 'review-a', verdict: 'accepted' },
    { nodeKey: 'review-consensus', candidate: 'review-b', verdict: 'accepted' },
    { nodeKey: 'review-consensus', candidate: 'review-c', verdict: 'rejected' },
  ],
});

// Representative target result:
// {
//   kind: 'select',
//   nodeKey: 'review-consensus',
//   outcome: 'accepted',
//   activate: ['approval']
// }
```

If the policy can still require a missing verdict, the result is `wait`. Quorum bounds, tie behavior, candidate membership,
and exhaustive outcomes are validated during compilation.

### Human gate

Without an accepted normalized resolution fact, a human gate waits.

```ts
const waitingForHuman = decidePipeline(pipeline, {
  nodes: [{ key: 'approval', state: 'waiting' }],
  gateResolutions: [],
});

// Representative target result:
// { kind: 'wait', nodeKey: 'approval', reason: 'gate-unresolved' }
```

Once the consumer supplies an accepted resolution, the package selects the declared graph outcome.

```ts
const gateDecision = decidePipeline(pipeline, {
  nodes: [{ key: 'approval', state: 'waiting' }],
  gateResolutions: [{ nodeKey: 'approval', resolution: 'approved' }],
});

// Representative target result:
// {
//   kind: 'select',
//   nodeKey: 'approval',
//   outcome: 'approved',
//   activate: ['publish']
// }
```

The consumer owns authorization, answer compare-and-set, storage, notification, durable wake-up, and the waiting runtime
node instance. There is no persisted gate entity in this package.

## Keep application outside the package

The examples stop at `PipelineDecision` intentionally. A consumer is responsible for turning durable state into
`PipelineFacts` and applying a returned decision. The package receives no repository, transaction, queue, clock, worker,
executor, model, profile, prompt, credential, or workspace binding.

Deeply equal `CompiledPipeline` and `PipelineFacts` values always produce a deeply equal `PipelineDecision`. This semantic
idempotence does not claim exactly-once durable application; atomic changes, optimistic concurrency, fencing, duplicate
delivery, retries, outputs, events, and recovery remain consumer responsibilities.
