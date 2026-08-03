# Architecture

`@revisium/revo-pipeline` is a zero-runtime-dependency, pure ESM library.

```text
PipelineDefinition --compilePipeline--> CompiledPipeline + unresolved PipelineExecutionTemplate
unknown JSON --decodeCompiledPipeline--> CompiledPipelineDecoding
CompiledPipeline + PipelineFacts --decidePipeline--> PipelineDecision
CompiledPipeline + PipelineSnapshot + PipelineCommand --reducePipeline--> PipelineReduction
```

The package owns validation, canonical graph data, task/branch/fork/join/consensus/
human-gate/terminal semantics, and ordered atomic effect data. The host owns runs,
persistence, transactions, compare-and-swap, clocks, retries, authorization, agents,
scripts, and applying effects.

Native script definitions are authoring sugar at this boundary: compilation lowers them
to ordinary task nodes in `CompiledPipeline` and separately returns copied, frozen,
unresolved executor requirements. Task-only definitions and consumers of
`compilation.pipeline` remain compatible. The package never resolves or runs a script;
see [ADR 0003](./adr/0003-native-script-definitions-and-unresolved-execution-templates.md).

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
