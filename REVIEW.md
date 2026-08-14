# Review Contract

Findings cite a concrete file and line, violated contract, risk, and smallest sufficient
correction.

## Blocking findings

- Package metadata differs from the approved `0.1.0-alpha.1` prerelease, `publishConfig`
  differs from `{ access: public, tag: alpha }`, a publication-blocking hook or
  `private` flag returns, or a release/publish workflow appears.
- Root or `./kernel` runtime/type inventories differ from Pipeline Conformance v1, a
  deep/default/CommonJS/wildcard export appears, or the shared `PipelineProgramSchema`
  is not the same runtime value.
- A compatibility adapter, dual reader, deprecated alias, hidden interpreter, runtime
  plugin, or source/IR kind outside the closed 12/9 vocabularies appears.
- Pipeline behavior depends on run IDs, time, persistence, attempts, leases, retries,
  resolved bindings, authorization, or other host state.
- The six-layer DAG, curated indexes, exact root allowlist, no-layer-to-root rule, or
  reserved `src/extensions` prohibition is bypassed.
- Foundation hostile-input, portable-value, schema, diagnostic, canonicalization, or
  full SHA-256 invariants regress.
- Program digest admission omits complete Program semantics or requirement/provenance
  cross-references, validates/hashes different owned values, leaks rejected input, or
  diverges from compiler emission.
- Observable compiler/kernel semantics lack behavior tests, packed output contains
  maps/source, the package smoke links the checkout, or a verification warning is
  suppressed.

## Required evidence

- `corepack pnpm verify` passes on the reviewed tree.
- Exact production dependencies and tool pins remain unchanged.
- Foundation, source/materialization, Program/compiler, and kernel suites cover their
  owning contracts and hostile/error boundaries.
- Package verification proves the exact ESM entrypoints and file inventory, declarations,
  negative deep/default/CommonJS imports, and execution of the tracked quick-start from
  an installed tarball.
- The intent ownership matrix is byte-identical unless a separately approved ownership
  change is in scope.
- CI, Sonar, and valid review threads are green on the same exact PR head.

These are reviewed-change guardrails, not a security sandbox against a contributor who
changes implementation and verification together.
