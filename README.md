<div align="center">

# @revisium/revo-pipeline

**Portable pipeline source, deterministic compilation, and a pure command-producing kernel.**

[![CI](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

> [!IMPORTANT]
> Publication is blocked. The implemented foundation, source, materialization, Program,
> compiler, and final private kernel layers are private, the root module has no runtime exports, and this is
> not an installable consumer API.

## Status

Accepted [ADR 0005](docs/adr/0005-greenfield-language-compiler-kernel-cutover.md)
establishes a direct greenfield cutover to one source-language/compiler/closed-IR/pure-
kernel architecture. There is no adapter, converter, dual reader, deprecated alias,
compatibility window, hidden interpreter, or runtime node-kind plugin.

The six normative contracts remain Draft until conformance and consumer readiness are accepted:

- [Pipeline Source v1](docs/specs/pipeline-source-v1.spec.md)
- [Pipeline Materialization v1](docs/specs/pipeline-materialization-v1.spec.md)
- [Pipeline Program v1](docs/specs/pipeline-program-v1.spec.md)
- [Pipeline Machine v1](docs/specs/pipeline-machine-v1.spec.md)
- [Pipeline Canonicalization v1](docs/specs/pipeline-canonicalization-v1.spec.md)
- [Pipeline Conformance v1](docs/specs/pipeline-conformance-v1.spec.md)

The current private implementation includes the exact
12-kind TypeBox source language, recursive local-region semantics, canonical source
normalization and digesting, reachable agent-slot paths, and source-pinned portable
profile materialization. It also includes the closed nine-kind Program IR and a compiler
that links, checks dataflow and composed bounds, lowers all source forms, emits complete
requirements/provenance, and hashes an immutable bundle.
Its production dependencies are exactly `typebox@1.3.10` and `canonicalize@3.0.0`;
hashing uses `node:crypto`. `src/index.ts` remains deliberately inert. The final `.` and
`./kernel` exports are introduced only after conformance and consumer
readiness are proved. Lifecycle acceptance still does not publish a release;
publication remains a separate human gate.

The private kernel materializes the complete Machine v1 schemas and structural
identities, shares bounded Program admission with the compiler, and executes all nine IR
node kinds to global quiescence. It includes waits, gates, structured parallel/vote,
repeat, bounded map refill, overlapping cancellation acknowledgement, replay, and the
final private `createInitialPipelineState` / `advancePipeline` functions. The root and
package subpath remain unavailable until conformance readiness.

## Contract shape

The source language has exactly 12 node kinds: `agent`, `script`, `effect`, `choice`,
`parallel`, `repeat`, `map`, `wait`, `humanGate`, `consensus`, `call`, and `end`.
Compilation produces exactly nine IR node kinds: `activity`, `choice`, `call`,
`parallel`, `repeat`, `map`, `wait`, `humanGate`, and `end`. Control flow uses targets
and structured regions; there is no sequence node.

The intended flow is:

```text
PipelineSourcePackage + ProfileMaterialization
                       |
                       v
             compile/link/materialize
                       |
                       v
PipelineProgram + ProgramRequirements + ProgramProvenance + programDigest
                       |
                       v
           pure state transition + host commands
```

The package performs no I/O. `revo-core` resolves exact bindings and constructs a plan;
`revo-run` owns durable execution, attempts, retries, timers, reconciliation,
authorization, events, subscriptions, and dynamic identities.

The [ownership matrix](docs/conformance/revo-run-intent-ownership.md) has 103 unique
traceability rows: compiler 22, kernel 32, core 7, and run 42. Those rows partition into
pipeline evidence 54 and host evidence 49; host evidence includes core/run
cross-package fixtures. They are traceability requirements, not 103 pipeline
implementations.

The machine-readable [layer manifest](architecture/layers.json) marks `foundation`,
`source`, `materialization`, `program`, `compiler`, and `kernel` active. Extensions
remains a future private record; its directory does not exist yet. Imports
between active layers must use the target layer's curated `index.ts`, same-layer peer
imports are allowed, and no layer may import the inert root module.

The canonical sequential schedule and evidence state live only in the
[delivery plan](docs/delivery-plan.md). Every intermediate state remains nonpublishable.

## Documentation

- [Architecture](docs/architecture.md)
- [Delivery plan and specification traceability](docs/delivery-plan.md)
- [Host integration](docs/host-integration.md)
- [Specifications](docs/specs/)
- [Architecture decision](docs/adr/0005-greenfield-language-compiler-kernel-cutover.md)
- [Intent ownership](docs/conformance/revo-run-intent-ownership.md)
- [Repository map](REPOSITORY.md)
- [Verification](VERIFICATION.md)

## Development

Requires Node.js `>=24.11.1 <25` and pnpm 11.13.0 through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

Focused work can use
`corepack pnpm exec vitest run test/foundation test/source test/materialization test/program test/compiler test/kernel`
before the required full gate. Architecture and package checks remain part of `verify`.

Publishing, tagging, releasing, and merging require separate approval.
