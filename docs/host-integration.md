# Host integration

The package is a pure semantic component. A durable host owns authorization,
persistence, transactions, revisions, IDs, clocks, retries, and effect application.

For each transition attempt:

1. Load the compiled pipeline, complete settled snapshot, external input, and one
   revision guard.
2. Decode serialized compiled data. On failure, write nothing.
3. Authorize input and construct one portable command.
4. Reduce once. On failure, write nothing.
5. Map the next snapshot and entire ordered effect batch to one indivisible host change.
6. Commit only if every loaded authoritative revision still matches.
7. On conflict, discard all derived data and restart from the load.

The guard must cover the compiled identity/schema, every record projected into the
snapshot, authorization input, and mapping expectations. Never apply a batch prefix,
reorder effects, or reuse decoded, projected, authorized, reduced, or mapped values
after a conflict.

Human-gate identity, authentication, authorization, inboxes, audit storage,
notifications, timeouts, and retry policy remain host-owned. The package validates only
the portable command and pipeline semantics.

Exact snapshot, command, effect, fault, and replay behavior is normative in the
[reducer specification](./specs/pipeline-reducer-v1.spec.md).
