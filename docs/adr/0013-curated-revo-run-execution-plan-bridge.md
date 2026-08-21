# ADR 0013: Curated revo-run execution-plan bridge

- Status: Accepted
- Amends: ADR 0005, ADR 0011

## Context

The Draft compiler bundle is portable and intentionally host-neutral. A narrow consumer
evaluation path is nevertheless useful for hosts that need a plain execution-plan
payload. The bridge therefore owns its small payload contract rather than importing a
runtime package contract.

## Decision

`@revisium/revo-pipeline/revo-run` is a third curated ESM entrypoint. It exposes
`compileToExecutionPlan(source, materialization, { bindings, policies })` and no root
exports. It calls the existing compiler once, preserves a compiler failure unchanged
under `stage: 'compile'`, and otherwise lowers the already compiled bundle without
rereading source or materialization.

The bridge is an explicit integration facade outside the six language/kernel dependency
layers. It imports only curated pipeline indexes. Its execution-plan, node, binding, and
policy types are owned by this package and its output is a plain JSON structural payload
for a consumer host; it neither imports a runtime contract nor mirrors host admission.

The first executable slice accepts exactly one entry module containing only tree-shaped
`choice` and `end` Program nodes, no requirements, and no supplied bindings. Choices use
only string `equals`/`oneOf` cases, an explicit default, and literal or top-level module
input selectors. Ends always map to successful completion while retaining their authored
outcome and supported literal/module-input output mappings. All other valid
Program forms return deterministic, provenance-linked execution-plan diagnostics; no
form is approximated.

Bridge inputs are explicit pipeline-owned policies and an empty binding set. They are not
source, materialization, profile, assignment, or persisted binding formats. This bridge
does not define or compute a plan digest, alter compiler/program semantics, or change the
root/kernel APIs.

## Consequences

The package gains one tightly constrained consumer-integration surface while preserving
the direct-cutover language and kernel boundaries of ADR 0005. Extending the supported
slice requires a new explicit decision and behavior evidence; compatibility readers,
hidden interpreters, and deep imports remain forbidden.
