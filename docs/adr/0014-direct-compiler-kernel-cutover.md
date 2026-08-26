# ADR 0014: Direct compiler/kernel cutover

- Status: Accepted
- Date: 2026-08-25
- Supersedes: ADR 0013
- Amends: ADR 0005, ADR 0011

## Context

The package must provide one deterministic path from portable source plus caller
selections to the closed Program and pure kernel. The former third package facade and
public profile-materialization document exposed a second consumer boundary that is no
longer part of that path.

## Decision

The root compiler signature is `compilePipeline(source, selections)`. Selection
validation, canonicalization, and the materialization digest are internal compiler
work. The root exports `PipelineSelectionsSchema`, `PipelineSelections`,
`PipelineSelection`, `ScriptPin`, `AgentActivityInputSchema`, and
`AgentActivityInput`; script pins are `{id, version}` with a positive version.
`inspectPipelineSlots(source)` is the root read-only discovery API: it validates source
and returns reachable agent node IDs with their selectable strategy descriptors.

The source and Program remove the legacy activity kind and its requirement. Agents use
the fixed portable `{prompt, metadata?}` envelope. Human gates carry a nullable payload
schema and nullable `{afterMs,target}` deadline; resolution is one-shot and has no
conflict branch. The package exports only `.` and `./kernel`; the former third facade,
its source, tests, and package export are deleted.

## Consequences

This is a breaking alpha cutover with no compatibility reader or bridge. The compiler
and kernel remain deterministic and host-neutral; hosts receive only the emitted
Program bundle and kernel commands. ADR 0013 is retained solely as superseded history.
