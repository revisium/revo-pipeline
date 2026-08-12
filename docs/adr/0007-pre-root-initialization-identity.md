# ADR 0007: Pre-root initialization identity

- Status: Accepted
- Version: 1.0.0
- Date: 2026-08-12

## Context

An invalid admitted Program must produce a failed `PipelineState` and one structural
`fail` command. A malformed Program may not expose a root region, so no root frame key
exists. Substituting an arbitrary digest would create a false frame identity and could
collide structurally with executable work.

The failure must remain deterministic and value-redacted even when the input has no
lexically valid `programDigest`.

## Decision

`FrameKeyPayload` gains one pre-root variant:

```ts
{
  readonly kind: 'initialization';
  readonly parentFrameKey: null;
  readonly programDigest: Digest | null;
}
```

The kernel reads only an own data-property candidate `programDigest`. A lexically valid
digest is retained; every other value becomes `null`. The initialization frame key is
the `pipeline-frame-key/v1` digest of that exact payload. The failed state's and command
reference's effective `programDigest` is the candidate when present, otherwise the
initialization frame key itself. The command reference uses that frame key and
`nodeId:'$pipeline'`.

This identity is a causal anchor only for `PROGRAM_INVALID`. It is never an executable
frame and never appears in `PipelineState.frames`. `INIT_INPUT_SCHEMA` occurs after a
valid Program has established the actual root-region key and uses that root identity
with the admitted `programDigest`.

## Consequences

- Invalid Program initialization has one real, domain-separated structural identity.
- Failed initialization state and commands contain no rejected input value.
- No run ID, random value, clock, or host identity enters the payload.
- Root, call, parallel, repeat, and map identities remain unchanged.

## Relationship to prior decisions

This decision refines ADR 0005's pure-kernel identity boundary. It is independent of ADR
0006's live-receipt and durable-host replay ownership.
