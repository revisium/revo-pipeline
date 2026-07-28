# @revisium/revo-pipeline

[![CI](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml)
[![Sonar quality gate](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![Sonar coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Portable pipeline definitions, deterministic compilation, pure semantic decisions, and
pure snapshot reduction for Revo.

This repository artifact implements `@revisium/revo-pipeline` version `0.0.0`.
Registry publication is a separate authorized release operation; a source checkout,
README, badge, or package-verification result does not establish registry availability.
The public root contains exactly five runtime values and 86 Accepted readonly types.

## Installation and package use

After the exact version has been independently confirmed in the registry, install it
with:

```bash
corepack pnpm add @revisium/revo-pipeline@0.0.0
```

The package requires Node.js `>=24.11.1 <25`. It is strict ESM, has one named-export
root, bundles TypeScript declarations, has zero runtime dependencies, and denies
default, alias, subpath, and deep imports.

## Choosing an API

| Value                    | Use                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `definePipeline`         | Preserve literal inference for a readonly definition; it returns the same value and does not validate, copy, retain, or freeze it.            |
| `compilePipeline`        | Validate and canonicalize a definition into a newly owned frozen `CompiledPipeline`, or receive bounded definition faults.                    |
| `decodeCompiledPipeline` | Validate `unknown` as the exact canonical compiled-v1 representation; it does not repair or recompile input.                                  |
| `decidePipeline`         | Inspect a compiled pipeline and one complete `PipelineFacts` projection to obtain one pure semantic intent.                                   |
| `reducePipeline`         | Apply or replay one command in call-local state and drain to a settled wait or terminal, returning a frozen snapshot and atomic effect batch. |

Narrow compiler, decoder, and reducer results by `ok`; then narrow reducer success by
`status`. Narrow decisions by `kind`. Use `decidePipeline` for inspection or when the
consumer deliberately applies individual semantic intents. Use `reducePipeline` as the
preferred durable-host command-to-settled-state seam. Do not call both to drive the same
transition.

## Task, branch, and terminal

This low-level example makes omission mean “not activated” and supplies complete facts
with all four collections.

<!-- package-example:start:task-branch-terminal -->

```ts
import assert from 'node:assert/strict';
import {
  compilePipeline,
  decidePipeline,
  definePipeline,
  type PipelineFacts,
} from '@revisium/revo-pipeline';

const source = {
  schemaVersion: 1 as const,
  entry: 'assess',
  facts: [{ key: 'risk', type: 'string' as const }],
  nodes: [
    {
      kind: 'task' as const,
      key: 'assess',
      outcomes: {
        completed: 'route',
        failed: 'stopped',
        cancelled: 'stopped',
        skipped: 'stopped',
      },
    },
    {
      kind: 'branch' as const,
      key: 'route',
      fact: 'risk',
      cases: [{ name: 'publish', when: { op: 'equals' as const, value: 'low' }, to: 'published' }],
      default: { name: 'reject', to: 'stopped' },
    },
    { kind: 'terminal' as const, key: 'published', outcome: 'published' },
    { kind: 'terminal' as const, key: 'stopped', outcome: 'stopped' },
  ],
};
const definition = definePipeline(source);
assert.equal(definition, source);
const compilation = compilePipeline(definition);
if (!compilation.ok) {
  throw new Error(compilation.faults.map(({ code, path }) => `${code} ${path}`).join('\n'));
}
assert.notEqual(compilation.pipeline, source);
assert.equal(Object.isFrozen(compilation.pipeline), true);
const pipeline = compilation.pipeline;
const facts = (
  nodes: PipelineFacts['nodes'],
  values: PipelineFacts['values'] = [],
): PipelineFacts => ({
  values,
  nodes,
  candidateVerdicts: [],
  gateResolutions: [],
});
assert.deepEqual(decidePipeline(pipeline, facts([])), {
  kind: 'activate',
  cause: { kind: 'entry' },
  nodeKeys: ['assess'],
});
assert.deepEqual(decidePipeline(pipeline, facts([{ key: 'assess', state: 'enabled' }])), {
  kind: 'wait',
  nodeKey: 'assess',
  reason: 'task-incomplete',
});
assert.deepEqual(
  decidePipeline(
    pipeline,
    facts(
      [{ key: 'assess', state: 'terminal', outcome: 'completed' }],
      [{ key: 'risk', value: 'low' }],
    ),
  ),
  {
    kind: 'activate',
    cause: { kind: 'node', nodeKey: 'assess', outcome: 'completed' },
    nodeKeys: ['route'],
  },
);
const factsA = facts(
  [
    { key: 'assess', state: 'terminal', outcome: 'completed' },
    { key: 'route', state: 'enabled' },
  ],
  [{ key: 'risk', value: 'low' }],
);
const factsB: PipelineFacts = JSON.parse(JSON.stringify(factsA)) as PipelineFacts;
assert.notEqual(factsA, factsB);
assert.notEqual(factsA.nodes, factsB.nodes);
assert.deepEqual(factsA, factsB);
const selection = decidePipeline(pipeline, factsA);
assert.deepEqual(selection, {
  kind: 'select',
  nodeKey: 'route',
  outcome: 'publish',
  activate: ['published'],
});
assert.deepEqual(selection, decidePipeline(pipeline, factsB));
assert.deepEqual(
  decidePipeline(
    pipeline,
    facts(
      [
        { key: 'assess', state: 'terminal', outcome: 'completed' },
        { key: 'route', state: 'terminal', outcome: 'publish' },
        { key: 'published', state: 'enabled' },
      ],
      [{ key: 'risk', value: 'low' }],
    ),
  ),
  { kind: 'terminal', nodeKey: 'published', outcome: 'published' },
);
```

<!-- package-example:end:task-branch-terminal -->

The package owns semantics for `task`, `branch`, `fork`, `join`, `consensus`,
`humanGate`, and `terminal`, but owns no storage, revision, transaction, retry,
authorization, inbox, queue, clock, worker, or effect application.

## Documentation

The version links match a released `@revisium/revo-pipeline@0.0.0` artifact only when
that separately authorized version and `v0.0.0` tag exist; they may be unavailable
before the tag is created. The current-development links are mutable, may differ from or
run ahead of a released artifact, and are for current source development and review.
They are not version-specific contract evidence for an installed package.

| Topic                               | Version 0.0.0 documentation (immutable release target)                                                            | Current development documentation (mutable)                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Documentation index                 | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/README.md)                                   | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/README.md)                                   |
| API reference                       | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/api.md)                                      | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/api.md)                                      |
| State machine, facts, and decisions | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/state-machine.md)                            | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/state-machine.md)                            |
| Host integration and CAS            | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/host-integration.md)                         | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/host-integration.md)                         |
| Scenario index                      | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/examples/README.md)                          | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/examples/README.md)                          |
| Fork/join/consensus scenario        | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/examples/fork-join-consensus-terminal.md)    | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/examples/fork-join-consensus-terminal.md)    |
| Human-gate/replay scenario          | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/examples/human-gate-terminal-replay.md)      | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/examples/human-gate-terminal-replay.md)      |
| Definition specification            | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/specs/pipeline-definition-v1.spec.md)        | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/specs/pipeline-definition-v1.spec.md)        |
| Transition specification            | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/specs/pipeline-transition-v1.spec.md)        | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/specs/pipeline-transition-v1.spec.md)        |
| Decoding specification              | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/specs/pipeline-decoding-v1.spec.md)          | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/specs/pipeline-decoding-v1.spec.md)          |
| Reducer specification               | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/specs/pipeline-reducer-v1.spec.md)           | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/specs/pipeline-reducer-v1.spec.md)           |
| Package-boundary ADR                | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/adr/0001-package-boundary.md)                | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/adr/0001-package-boundary.md)                |
| Decoder/reducer ADR                 | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/adr/0002-portable-decoding-and-reduction.md) | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/adr/0002-portable-decoding-and-reduction.md) |
| Architecture                        | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/architecture.md)                             | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/architecture.md)                             |
| Testing                             | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/testing.md)                                  | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/testing.md)                                  |
| Transition traceability             | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/transition-test-traceability.md)             | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/transition-test-traceability.md)             |

Working on current source means using the mutable `master` column. After release,
consumers of `0.0.0` use the immutable column. An unavailable tag or version does not
prove publication; current-development docs remain source-work guidance, not evidence
for an installed artifact.

## Development

Requires Node.js `>=24.11.1 <25` and pnpm 11.13.0 through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

Publishing, tagging, releasing, or merging requires separate approval.
