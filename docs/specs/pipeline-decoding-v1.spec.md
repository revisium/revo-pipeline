# Pipeline Decoding v1

- Status: Accepted
- Implementation: Shipped by PR6
- Target package: `@revisium/revo-pipeline`

## Public contract

```ts
export type DecodeFaultCode =
  | 'DECODE_TYPE'
  | 'DECODE_LIMIT'
  | 'DECODE_SCHEMA'
  | 'DECODE_REFERENCE'
  | 'DECODE_GRAPH'
  | 'DECODE_CANONICAL'
  | 'DECODE_DIAGNOSTIC_LIMIT';

export type DecodeFault = {
  readonly code: DecodeFaultCode;
  readonly path: string;
  readonly message: string;
};

export type CompiledPipelineDecoding =
  | { readonly ok: true; readonly pipeline: CompiledPipeline }
  | { readonly ok: false; readonly faults: readonly DecodeFault[] };

export declare function decodeCompiledPipeline(input: unknown): CompiledPipelineDecoding;
```

The function MUST be synchronous, deterministic, state-free, non-mutating, and perform
no I/O. It verifies the exact canonical compiled representation; it MUST NOT compile,
repair, or normalize noncanonical serialized input. Success returns a fresh,
package-owned, deeply frozen `CompiledPipeline` deeply equal to compiler output.
Failure retains neither input nor partial output.

## Inspection and diagnostics

Inspection MUST be descriptor-first, accessor-free for supported portable data, bounded,
and isolated from mutation. Existing Accepted compiled-v1 limits and reflection rules
apply. Throwing reflection traps are caught at their container. A proxy may run or fail
to terminate inside an ECMAScript trap; ordinary persisted JSON parsed with `JSON.parse`
has no such behavior.

Direct faults use the union order above, excluding the diagnostic sentinel. Within a
phase they sort by Unicode code-point path, code, then message. Paths are RFC 6901
pointers of at most 1,024 characters; messages are at most 512 characters. The global
maximum is 100 faults. Overflow returns the first 99 plus:

```ts
{ code: 'DECODE_DIAGNOSTIC_LIMIT',
  path: '/faults',
  message: 'Compiled pipeline diagnostic limit exceeded.' }
```

`DECODE_LIMIT` is reserved for input-bound violations. Consumers branch on codes, not
messages.

## Shipped example and proof

Implemented in PR6:

```ts
const compilation = compilePipeline(definition);
if (!compilation.ok) throw new Error('invalid definition');

const persisted: unknown = JSON.parse(JSON.stringify(compilation.pipeline));
const decoded = decodeCompiledPipeline(persisted);
if (!decoded.ok) reportPlanIntegrityFault(decoded.faults);
else useImmutableCompiledPipeline(decoded.pipeline);
```

PR6 owns the three types above, the decoder, the sole hostile compiled inspector, exact
root/layer manifests, round trips, tamper and hostile-input matrices, ordering, caps,
ownership, freezing, architecture controls, and package proof.
