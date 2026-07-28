# API reference

All functions are synchronous, deterministic, state-free, non-mutating, and perform no
I/O. Only named imports from `@revisium/revo-pipeline` are supported.

## `definePipeline`

`definePipeline<const Definition extends PipelineDefinition>(definition: Definition):
Definition`

This literal-inference helper returns the exact input reference. It performs no
validation, copy, freeze, registration, or retention. Its readonly guarantee is
TypeScript-level, not a runtime-freeze claim.

## `compilePipeline`

`compilePipeline(definition: PipelineDefinition): PipelineCompilation`

Compilation validates topology and semantic policy, copies retained data,
canonicalizes it, and constructs deterministic indexes. Narrow by `ok`. Success owns a
new deeply frozen `CompiledPipeline`; failure contains stable bounded
`DefinitionFault[]` and no pipeline.

### `CompiledPipeline`

`CompiledPipeline` is the package-owned, JSON-compatible canonical representation of
one validated definition. It contains normalized nodes, edges, facts, indexes, and
fork regions. It is readonly, deeply frozen, deterministic, and safe to serialize;
it contains no run state, host objects, callbacks, clocks, IDs, or persistence handles.
Compile a trusted definition once, or use `decodeCompiledPipeline` at the trust boundary
when loading serialized compiled JSON.

## `decodeCompiledPipeline`

`decodeCompiledPipeline(input: unknown): CompiledPipelineDecoding`

Decoding is the trust boundary for serialized compiled data. It accepts only the exact
canonical v1 representation and never repairs, normalizes, or recompiles it. Narrow by
`ok`; success is a new deeply frozen `CompiledPipeline` and failure is bounded
`DecodeFault[]`.

## `decidePipeline`

`decidePipeline(pipeline: CompiledPipeline, facts: PipelineFacts): PipelineDecision`

The low-level inspection/control seam validates compiled integrity and one complete
facts projection, then returns one `activate`, `select`, `wait`, `terminal`, defensive
`noop`, or `reject` intent. Narrow by `kind`; `reject` carries `DecisionFault[]`.
Nothing is applied or persisted.

## `reducePipeline`

`reducePipeline(pipeline: CompiledPipeline, snapshot: PipelineSnapshot, command:
PipelineCommand): PipelineReduction`

The preferred durable-host seam validates one settled snapshot and one compound
command, detects exact replay/conflict, applies the command in call-local state, and
drains autonomous decisions. Narrow first by `ok`, then by `status`. Success is
`waiting` or `terminal`, reports `application: 'applied' | 'unchanged'`, and owns a new
frozen snapshot plus ordered atomic batch. Failure contains
`PipelineReductionFault[]` and no snapshot or batch. The package never applies or
persists the batch.

Use `decidePipeline` when deliberately projecting and applying individual decisions;
use `reducePipeline` for command-to-settled-state integration. Do not call both to
drive one transition.

## Portable values and diagnostics

`JsonScalar` is exactly `null | boolean | number | string`; `FactType` is exactly
`'null' | 'boolean' | 'number' | 'string'`. Portable numbers are finite safe integers;
fractional, unsafe, and non-finite numbers reject. Strings follow Accepted NFC and
canonical limits, and numeric `-0` is normalized as specified.

Branch program logic on stable fault `code`, not `message`. Fault paths are RFC 6901
pointers and ordering is deterministic. Results contain at most 100 faults: the first
99 plus the contract-specific fixed root sentinel (`DEF_LIMIT`, `FACT_LIMIT`,
`DECODE_DIAGNOSTIC_LIMIT`, or `REDUCTION_DIAGNOSTIC_LIMIT`). Messages are bounded
diagnostics, not compatibility keys. These guarantees cover supported portable input;
ECMAScript proxies cannot receive stronger termination or side-effect guarantees.
