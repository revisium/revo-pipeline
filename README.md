<div align="center">

# @revisium/revo-pipeline

**Portable pipeline source, deterministic compilation, and a pure command-producing kernel.**

[![CI](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

> [!IMPORTANT]
> This package is under development. Version `0.2.0-alpha.1` is an unstable prerelease,
> not a 1.0 API, and carries no compatibility guarantee. Alpha publication does not
> claim that `revo-core` or host-runtime integration is ready.

## About

`@revisium/revo-pipeline` validates a closed pipeline source language, materializes
abstract agent selections, compiles the result into a deterministic Program, and
advances that Program through a pure state machine. It performs no I/O and owns no
database, queue, clock, provider, authorization, retry, or durable run state.

The source language contains 12 node kinds and compiles to a closed nine-kind IR. The
package exposes three curated ESM entrypoints: the authoring/compiler API at `.`, the
machine API at `./kernel`, and the pipeline-owned execution-plan bridge at `./execution-plan`.
No internal folder is a supported deep import.

## Usage

Install the current prerelease explicitly from the npm `alpha` tag:

```bash
corepack pnpm add @revisium/revo-pipeline@alpha
```

For development against this checkout, build and install a local tarball:

```bash
corepack pnpm pack
corepack pnpm add --offline ./revisium-revo-pipeline-0.2.0-alpha.1.tgz
```

## API at a glance

The root entrypoint validates source and materialization documents, computes their
digests, compiles them, and verifies a complete Program bundle digest. The `./kernel`
entrypoint creates and advances the pure machine state:

```ts
import { compilePipeline, computeProgramDigest } from '@revisium/revo-pipeline';
import { advancePipeline, createInitialPipelineState } from '@revisium/revo-pipeline/kernel';

const compiled = compilePipeline(source, materialization);
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

const programDigest = computeProgramDigest({
  program: compiled.program,
  requirements: compiled.requirements,
  provenance: compiled.provenance,
});
const bundle = { program: compiled.program, programDigest };
const initial = createInitialPipelineState(bundle, input);
const next = advancePipeline(bundle, initial.state, event);
```

Use `definePipelineSource`, `defineProfileMaterialization`, `computeSourceDigest`, and
`computeMaterializationDigest` when constructing those inputs. The complete executable
example is [examples/quick-start.ts](examples/quick-start.ts). It compiles an agent
activity followed by a script activity, checks all three public digests, advances both
activities, and verifies idempotent event replay:

```bash
node examples/quick-start.ts
```

Package verification runs that exact tracked file against the normally packed tarball
inside an isolated consumer.

The host persists state, applies returned commands, and passes resulting semantic events
to `advancePipeline`. See [host integration](docs/host-integration.md) for that boundary.

## Documentation

- [Architecture](docs/architecture.md)
- [Host integration](docs/host-integration.md)
- [Draft specifications](docs/specs/)
- [Architecture decisions](docs/adr/)
- [Intent ownership](docs/conformance/host-intent-ownership.md)
- [Repository map](REPOSITORY.md)
- [Verification](VERIFICATION.md)

## Development

Requires Node.js `>=24.11.1 <25` and pnpm `11.13.0` through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`verify` builds the declarations and JavaScript, checks one tarball with publint and Are
the Types Wrong, installs it into a clean external ESM/TypeScript consumer, and runs the
tracked quick-start. Declaration and source maps are omitted.
