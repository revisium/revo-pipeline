# Architecture

## Purpose

The package is a deterministic pipeline language and decision engine. It lets a consumer
store a portable definition, compile it once, and repeatedly ask what graph action is
enabled by supplied facts.

```text
portable PipelineDefinition
            |
            v
pure validation and compilation
            |
            v
portable CompiledPipeline
            |
            + supplied PipelineFacts
            v
pure PipelineDecision
```

Compilation rejects malformed topology and normalizes graph structure. It does not bind
models, profiles, prompts, agents, scripts, workspaces, credentials, or durable storage.
Those bindings produce an orchestrator-owned immutable `ExecutionPlan`.

Decision evaluation is referentially transparent. Every fact that can change an answer is
supplied explicitly. The package neither remembers a previous call nor commits the
decision.

## Semantic ownership

- Branch selects deterministic outgoing paths from explicit facts.
- Fork enables declared branches without scheduling or creating durable work.
- Join describes which branch completions satisfy a barrier.
- Consensus describes candidate/quorum/decision rules, not agent execution.
- Human gate describes an answer contract and how supplied resolution facts affect the
  next decision, not an inbox, waiter, database row, or authorization service.

The package describes semantic node identities present in the definition. Runtime
instance ids, attempts, duplicate-delivery protection, leases, timestamps, idempotency
keys, and atomic state transitions belong to `@revisium/revo-run`.

## Dependency boundary

`@revisium/revo-run` may consume the pipeline package. This package never imports run.
The orchestrator consumes both, compiles host bindings, and operates workers.

```text
@revisium/revo-pipeline
          |
          v
@revisium/revo-run
          |
          v
orchestrator application / worker / adapters
```

Agents and scripts are leaf executors selected by the orchestrator; neither is a pipeline
dependency. Persistence and queues are infrastructure behind run/application contracts.

## Internal structure

The target layers and import matrix are in [REPOSITORY.md](../REPOSITORY.md) and the
Draft internal structure specification. The structural validator, Oxlint cycle rule,
synthetic positive graph, and exact negative probes make the rules executable before
business source exists.

## Public surface

The foundation ships an intentionally empty ESM root. Draft examples are non-executable.
An API is exported only after its specification is accepted and implementation, tests,
declarations, package proof, and README agree.
