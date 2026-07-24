# Consumer Example

> [!IMPORTANT]
> The following is an accepted contract example, not executable package code. The package
> is unpublished and `src/index.ts` is exactly `export {};`; imports become valid only
> after a later implementation/public-export slice.

```ts
import { compilePipeline, decidePipeline, definePipeline } from '@revisium/revo-pipeline';

const definition = definePipeline({
  schemaVersion: 1,
  entry: 'prepare',
  facts: [{ key: 'reviewRequired', type: 'boolean' }],
  nodes: [
    {
      key: 'prepare',
      kind: 'task',
      outcomes: {
        completed: 'route',
        failed: 'cancelled',
        cancelled: 'cancelled',
        skipped: 'cancelled',
      },
    },
    {
      key: 'route',
      kind: 'branch',
      fact: 'reviewRequired',
      cases: [{ name: 'review', when: { op: 'equals', value: true }, to: 'reviews' }],
      default: { name: 'skip', to: 'approval' },
    },
    {
      key: 'reviews',
      kind: 'fork',
      join: 'joined',
      branches: [
        { name: 'a', entry: 'review-a', exit: 'review-a' },
        { name: 'b', entry: 'review-b', exit: 'review-b' },
      ],
    },
    {
      key: 'review-a',
      kind: 'task',
      outcomes: { completed: 'joined', failed: 'joined', cancelled: 'joined', skipped: 'joined' },
    },
    {
      key: 'review-b',
      kind: 'task',
      outcomes: { completed: 'joined', failed: 'joined', cancelled: 'joined', skipped: 'joined' },
    },
    {
      key: 'joined',
      kind: 'join',
      fork: 'reviews',
      policy: { kind: 'all' },
      outcomes: { completed: 'approval', rejected: 'cancelled', insufficient: 'cancelled' },
    },
    {
      key: 'approval',
      kind: 'humanGate',
      subject: 'Approve the prepared change',
      resolutions: [
        { resolution: 'approved', to: 'published' },
        { resolution: 'rejected', to: 'cancelled' },
      ],
    },
    { key: 'published', kind: 'terminal', outcome: 'published' },
    { key: 'cancelled', kind: 'terminal', outcome: 'cancelled' },
  ],
});

const compilation = compilePipeline(definition);
if (!compilation.ok) throw new Error(compilation.faults.map((fault) => fault.message).join('\n'));
const pipeline = compilation.pipeline;
```

The first empty snapshot asks the host to enable `prepare`:

```ts
decidePipeline(pipeline, { values: [], nodes: [], candidateVerdicts: [], gateResolutions: [] });
// { kind: 'activate', cause: { kind: 'entry' }, nodeKeys: ['prepare'] }
```

After a task terminal fact, branch selection is data-driven and never first-match:

```ts
decidePipeline(pipeline, {
  values: [{ key: 'reviewRequired', value: true }],
  nodes: [
    { key: 'prepare', state: 'terminal', outcome: 'completed' },
    { key: 'route', state: 'enabled' },
  ],
  candidateVerdicts: [],
  gateResolutions: [],
});
// { kind: 'select', nodeKey: 'route', outcome: 'review', activate: ['reviews'] }
```

A fork selection records `forked` and enables its entries plus the join atomically. A
join derives readiness from `review-a`/`review-b` exit facts—there is no `JoinArrival`,
arrival counter, or branch-lifecycle fact. A gate waits while enabled with no resolution,
then selects its declared target when supplied with one. The host owns durable state,
authorization, application/CAS, retries, and disposition of unfinished work after an
early `any`/threshold join; this package only returns the repeatable semantic decision.
