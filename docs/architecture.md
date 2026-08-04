# Architecture

Architecture validation follows [ADR 0004](./adr/0004-behavior-first-architecture-validation.md):
stable module grammar is checked declaratively, while observable semantics are verified
at behavior and package boundaries.

`@revisium/revo-pipeline` is a zero-runtime-dependency, pure ESM library.

```text
PipelineDefinition --compilePipeline--> CompiledPipeline + unresolved PipelineExecutionTemplate
CompiledPipeline + PipelineFacts --decidePipeline--> PipelineDecision
```

The package owns author-input validation, canonical graph data, and pure
task/branch/fork/join/consensus/human-gate/terminal decision semantics. The host
owns runs, durable execution, persistence, retries, authorization, agents,
scripts, and applying decisions.

`compilePipeline` validates untrusted author input and produces canonical,
frozen JSON data. `decidePipeline` treats its compiled input as trusted output
of that compiler: a host persists compiled pipelines with a digest pin and
passes them back unchanged. Facts arrive from the host's own execution history;
decisions are pure functions of (pipeline, facts).

Native script definitions are authoring sugar at this boundary: compilation lowers them
to ordinary task nodes in `CompiledPipeline` and separately returns copied, frozen,
unresolved executor requirements. Task-only definitions and consumers of
`compilation.pipeline` remain compatible. The package never resolves or runs a script;
see [ADR 0003](./adr/0003-native-script-definitions-and-unresolved-execution-templates.md).

Internal dependency direction is:

```text
spec
policy
spec + policy <- errors
spec + policy + errors <- graph
spec + policy + errors + graph <- definition
spec + policy + errors + graph <- transition
```

The accepted [definition](./specs/pipeline-definition-v1.spec.md) and
[transition](./specs/pipeline-transition-v1.spec.md) specifications are
normative. The accepted [ADRs](./adr/) record boundary decisions.
