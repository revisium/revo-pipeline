<div align="center">

# @revisium/revo-pipeline

**Portable pipeline source, deterministic compilation, and a pure command-producing kernel.**

[![CI](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

> [!IMPORTANT]
> Publication is blocked. The reset package has no runtime exports and is not an
> installable consumer API.

## Status

Accepted [ADR 0005](docs/adr/0005-greenfield-language-compiler-kernel-cutover.md)
establishes a direct greenfield cutover to one source-language/compiler/closed-IR/pure-
kernel architecture. There is no adapter, converter, dual reader, deprecated alias,
compatibility window, hidden interpreter, or runtime node-kind plugin.

The six normative contracts remain Draft through `rp-06`:

- [Pipeline Source v1](docs/specs/pipeline-source-v1.spec.md)
- [Pipeline Materialization v1](docs/specs/pipeline-materialization-v1.spec.md)
- [Pipeline Program v1](docs/specs/pipeline-program-v1.spec.md)
- [Pipeline Machine v1](docs/specs/pipeline-machine-v1.spec.md)
- [Pipeline Canonicalization v1](docs/specs/pipeline-canonicalization-v1.spec.md)
- [Pipeline Conformance v1](docs/specs/pipeline-conformance-v1.spec.md)

`rp-00` is the physical reset, documentation baseline, and fail-closed publication
block. `src/index.ts` is deliberately inert. The final `.` and `./kernel` exports are
introduced only by `rp-06` after conformance and consumer readiness are proved. Lifecycle
acceptance still does not publish a release; publication remains a separate human gate.

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

## Sequential master plan

1. `rp-00` — physical reset, accepted architecture docs, Draft specs, and publication
   block.
2. `rp-01` — foundation primitives and exact production dependencies.
3. `rp-02` — source language and profile materialization.
4. `rp-03` — compiler, linker, Program IR, provenance, and digests.
5. `rp-04` — base pure kernel.
6. `rp-05` — structured coordination, cancellation, waits, and gates.
7. `rp-06` — conformance, consumer readiness, final exports, and lifecycle acceptance.

Every intermediate state remains nonpublishable.

## Documentation

- [Architecture](docs/architecture.md)
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

Publishing, tagging, releasing, and merging require separate approval.
