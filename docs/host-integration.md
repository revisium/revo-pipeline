# Host integration

The package is a pure semantic component. A durable host owns authorization,
persistence, runs, retries, effect execution, and the record of facts.

The integration loop is fact-driven:

1. Compile the pipeline once at authoring time; persist the compiled JSON with a
   digest pin.
2. Start a run with the pinned compiled pipeline and the initial fact set
   (usually empty; known `PipelineValueFact` inputs may be present from the
   start).
3. Call `decidePipeline(pipeline, facts)` and act on the decision:
   - `activate` — first record an enabled `NodeFact` for **every** returned
     node key as one durable fact update, then dispatch only the externally
     executable kinds (tasks, scripts, consensus candidates). Branches, gates,
     joins, and terminals progress through facts alone; omitting their enabled
     facts causes repeated activation or a run that can never reach its
     terminal.
   - `select` — apply as **one atomic fact update**: replace the selector's
     enabled fact with its terminal outcome and add an enabled fact for every
     key in `activate` together. Persisting the outcome without its targets
     produces a snapshot `decidePipeline` rejects with `FACT_CAUSAL`.
   - `wait` — wait for the next external fact, append it, and decide again.
     Wait inputs are task outcomes, consensus verdicts, human-gate
     resolutions, **and** `PipelineValueFact` entries (a
     `branch-fact-missing` wait resolves only when the host supplies the
     declared value fact).
   - `terminal` — the run is settled with the terminal outcome.
   - `reject` — the fact set is inconsistent; this is a host defect, not user
     input to retry.
4. Record every fact update durably before acting on the decision it produced,
   so a restarted host replays the same fact order and reaches the same
   decisions.

Decisions are pure and deterministic: identical pipeline and facts always yield
the identical decision. Hosts built on deterministic-replay engines can hold
facts in workflow state and re-derive everything else.

Human-gate identity, authentication, authorization, inboxes, audit storage,
notifications, timeouts, and retry policy remain host-owned. The package
validates only fact semantics against the compiled pipeline.

Exact decision, fault, ordering, and bound behavior is normative in the
[transition specification](./specs/pipeline-transition-v1.spec.md).
