# ADR 0005: Greenfield language/compiler/kernel cutover

- Status: Accepted
- Version: 1.0.0
- Date: 2026-08-10

## Context

The package needs one portable boundary for versioned playbook source, profile-selected
agent slots, linked modules, typed dataflow, bounded structured coordination, and a pure
command-producing kernel. The host runtime is a future consumer, not a prerequisite for package
development or alpha publication.

Evolving incompatible contracts in parallel would preserve competing languages and
force consumers to depend on transition artifacts before the future core/run boundary is
ready.

## Decision

Adopt one greenfield source-language/compiler/closed-IR/pure-kernel architecture through
a direct cutover. No converter, adapter, dual reader, deprecated alias, compatibility
package, hidden second interpreter, or runtime node-kind plugin will be built.
`revo-pipeline` never imports a host. Any future host-runtime integration imports the narrow
kernel only and is a separate compatibility decision.

The first alpha permits an internal compile-time lowering seam only. Starting with the
foundation work item, production dependencies are exactly `typebox@1.3.10` and
`canonicalize@4.0.0`; SHA-256 uses `node:crypto`. `fast-check` may be exact-pinned for
development tests. Ajv and XState are not production dependencies.

Acceptance of this decision authorizes the architecture and direct reset. The six
normative specifications remain Draft through `rp-06`. The root and `./kernel` facades may
be evaluated and published as unstable alpha artifacts before consumer readiness; this
creates no compatibility guarantee. Publication and release remain separate human gates.

## Sequential delivery

1. `rp-00` performs the physical reset, accepts the architecture documentation, retains
   the six Draft specs, and blocks publication.
2. `rp-01` implements foundation schemas, portable values, diagnostics, bounds,
   canonicalization, and hashing.
3. `rp-02` implements source and materialization.
4. `rp-03` implements compiler/linker, Program IR, requirements, provenance, and
   digests.
5. `rp-04` implements the base pure kernel.
6. `rp-05` implements structured coordination, cancellation, waits, and gates.
7. `rp-06` completes package conformance and introduces the exact alpha manifests.
   Consumer readiness and specification acceptance remain separate follow-up decisions.

Every intermediate work item is nonpublishable. `rp-06` acceptance still does not
publish.

## Consequences

- Pre-release consumers migrate once, after final readiness.
- A closed IR keeps runtime replay and validation bounded; new authoring forms lower at
  compile time or require a versioned language decision.
- Profile structure may change `programDigest`; exact executor binding remains core/run
  owned and affects only plan lineage.
- Core/run admission validates and hashes the complete compiler bundle. The kernel trusts
  the admitted program/digest pair, keeps structural identity free of run IDs, and owns
  only live semantic state; run remains the durable audit authority.
- Semantic preservation is measured by 103 unique ownership rows: compiler 22, kernel
  32, core 7, run 42. This yields 54 pipeline-evidence and 49 host/cross-package evidence
  obligations, not 103 pipeline implementations.

## Alternatives considered

- Incrementally extend another language: rejected because it preserves obsolete public
  and host contracts.
- Add a compatibility compiler: rejected because it creates permanent transition
  surface.
- Use runtime plugins or XState: rejected because a closed explicit machine is easier to
  validate, replay, package, and audit.
