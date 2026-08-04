# Host integration

The package is a pure semantic component. A durable host owns authorization,
persistence, runs, retries, effect execution, and the record of facts.

The integration loop is fact-driven:

1. Compile the pipeline once at authoring time; persist the compiled JSON with a
   digest pin.
2. Start a run with the pinned compiled pipeline and an empty fact set.
3. Call `decidePipeline(pipeline, facts)` and act on the decision:
   - `activate` — start the named nodes (tasks, scripts, consensus candidates).
   - `select` — record the selector outcome; activate its targets.
   - `wait` — wait for the next external fact (a task outcome, a consensus
     verdict, a human-gate resolution), append it, and decide again.
   - `terminal` — the run is settled with the terminal outcome.
   - `reject` — the fact set is inconsistent; this is a host defect, not user
     input to retry.
4. Record every fact durably before acting on the decision it produced, so a
   restarted host replays the same fact order and reaches the same decisions.

Decisions are pure and deterministic: identical pipeline and facts always yield
the identical decision. Hosts built on deterministic-replay engines can hold
facts in workflow state and re-derive everything else.

Human-gate identity, authentication, authorization, inboxes, audit storage,
notifications, timeouts, and retry policy remain host-owned. The package
validates only fact semantics against the compiled pipeline.

Exact decision, fault, ordering, and bound behavior is normative in the
[transition specification](./specs/pipeline-transition-v1.spec.md).
