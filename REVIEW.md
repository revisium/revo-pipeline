# Review Contract

Findings cite a concrete file and line, the violated contract, the risk, and the smallest
sufficient correction.

## Blocking findings

- Shipped code or README claims a Draft API exists.
- Pipeline decisions depend on identifiers, time, persistence, CAS, attempts, leases,
  retries, resume mechanics, or host bindings.
- The package imports `@revisium/revo-run`, an agent/script package, Prisma, DBOS, a
  queue, or a host framework.
- `CompiledPipeline` contains orchestrator model/profile/prompt/workspace bindings or is
  described as a host-specific `ExecutionPlan`.
- Join, consensus, or gate semantics require hidden mutable package state.
- Transition evaluation performs I/O, reads a clock, generates an id, or mutates facts.
- A deep import, broad barrel, forbidden dependency, or value/type cycle bypasses the DAG.
- Stable architecture rules lack a positive graph and representative negative probes;
  observable semantics lack behavior, property, differential, or contract coverage.
- Package exports, declarations, docs, and packed behavior disagree.
- Verification failures or warnings are suppressed.
- A release can publish without a separate explicit approval.

## Required evidence

- `corepack pnpm verify` passes on the reviewed head.
- Workflow and shell conditional checks pass when those files change.
- The exact packed tarball passes ATTW, contents, ESM, strict TS, and deep-import denial.
- CI, Sonar when available, and valid review threads are green on the same head.
