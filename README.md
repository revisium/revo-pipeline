<div align="center">

# @revisium/revo-pipeline

**Portable pipeline source, deterministic compilation, and a pure command-producing kernel.**

[![CI](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

> [!IMPORTANT]
> Publication is blocked. The active `rp-01` foundation is private, the root module has
> no runtime exports, and this is not an installable consumer API.

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

`rp-01` is the active work item. It implements bounded portable values, identifiers,
RFC 6901 pointers, diagnostics, closed TypeBox object helpers, RFC 8785 canonicalization,
and all seven domain-separated SHA-256 primitives under the private `foundation` layer.
Its production dependencies are exactly `typebox@1.3.10` and `canonicalize@3.0.0`;
hashing uses `node:crypto`. `src/index.ts` remains deliberately inert. The final `.` and
`./kernel` exports are introduced only by `rp-06` after conformance and consumer
readiness are proved. Lifecycle acceptance still does not publish a release;
publication remains a separate human gate.

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

The machine-readable [layer manifest](architecture/layers.json) activates only
`foundation` at `rp-01`. Source, materialization, program, compiler, kernel, and
extensions remain future private records; their directories do not exist yet. Imports
between active layers must use the target layer's curated `index.ts`, same-layer peer
imports are allowed, and no layer may import the inert root module.

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

Focused foundation work can use `corepack pnpm exec vitest run test/foundation` before
the required full gate. Architecture and package checks remain part of `verify`.

Publishing, tagging, releasing, and merging require separate approval.
