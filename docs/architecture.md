# Architecture

`@revisium/revo-pipeline` is a zero-runtime-dependency, pure ESM library.

```text
PipelineDefinition --compilePipeline--> CompiledPipeline
unknown JSON --decodeCompiledPipeline--> CompiledPipelineDecoding
CompiledPipeline + PipelineFacts --decidePipeline--> PipelineDecision
CompiledPipeline + PipelineSnapshot + PipelineCommand --reducePipeline--> PipelineReduction
```

The package owns validation, canonical graph data, task/branch/fork/join/consensus/
human-gate/terminal semantics, and ordered atomic effect data. The host owns runs,
persistence, transactions, compare-and-swap, clocks, retries, authorization, agents,
scripts, and applying effects.

One reducer occurrence is one finite DAG traversal. Occurrence keys isolate executions;
bounded rework uses compile-time unrolling into distinct forward-only nodes. After a compare-and-swap
conflict, a host must reload and recompute rather than reuse derived data.

Internal dependency direction is:

```text
spec
policy
spec + policy <- errors
spec + policy + errors <- graph
spec + policy + errors + graph <- definition
spec + policy + errors + graph <- transition
```

The accepted [definition](./specs/pipeline-definition-v1.spec.md),
[transition](./specs/pipeline-transition-v1.spec.md),
[decoding](./specs/pipeline-decoding-v1.spec.md),
[reducer](./specs/pipeline-reducer-v1.spec.md), and
[module structure](./specs/internal-module-structure.spec.md) specifications are
normative. The accepted [ADRs](./adr/) record boundary decisions.
