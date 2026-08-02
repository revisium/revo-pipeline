# ADR 0003: Native Script Definitions and Unresolved Execution Templates

- Status: Accepted
- Date: 2026-08-02

## Context

Pipeline authors need to name versioned scripts and provide portable input without
moving execution, host bindings, or runtime state into this pure graph package. Existing
consumers depend on `CompiledPipeline` containing only the task-oriented semantic graph
consumed by decisions and reduction.

## Decision

Add `ScriptNode` as a native definition node. It pins a `script:` identity, a positive
safe-integer version, bounded portable JSON input, and the same four routes as a task.
Compilation lowers every script node to an ordinary compiled task node.

A successful compilation contains both `pipeline` and `template`. The template
references that exact pipeline object and adds canonical unresolved executor requirements
and terminal bindings. These records contain only portable declarations; they do not
choose or invoke an executor and do not map a terminal outcome to host state.

The compiler owns copied, normalized, deeply frozen successful output. Caller objects
remain caller-owned and unfrozen. Requirements sort by node key; terminal bindings sort
by node key and then outcome.

## Compatibility and ownership

Task-only authoring and all consumers of `compilation.pipeline` keep the existing pure
`CompiledPipeline` shape. There are still five runtime exports; the public root adds six
types and now contains 92 types. Host execution remains absent.

ADR 0002 continues to own portable compiled-pipeline decoding and pure reduction. This
decision does not add script data to `CompiledPipeline`, decoding, decisions, snapshots,
commands, effects, or reduction.

## Alternatives rejected

- Adding script identity and input to `CompiledNode` would couple pure graph semantics to
  authoring and execution concerns.
- Resolving an executor during compilation would require host configuration and make the
  compiler environment-dependent.
- Returning only a host execution plan would break existing compiled-pipeline consumers
  and reverse the package boundary.

## Consequences

Hosts may resolve the template into their own execution plan after compilation. They own
executor availability, authorization, attempts, clocks, persistence, retries, and
terminal-state mapping. This package remains deterministic, synchronous, and free of
host execution.
