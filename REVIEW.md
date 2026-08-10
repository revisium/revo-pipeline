# Review Contract

Findings cite a concrete file and line, the violated contract, the risk, and the smallest
sufficient correction.

## Blocking findings

- The package can publish, exposes a runtime value, or contains a release/publish
  workflow before `rp-06`.
- `package.json` regains a public entrypoint, files manifest, publish configuration,
  prepack hook, or production dependency during `rp-00`.
- A Draft root or `./kernel` API is exposed before `rp-06`.
- An adapter, converter, dual reader, deprecated alias, compatibility package, hidden
  interpreter, or runtime node-kind plugin is introduced.
- Source or IR contains a kind outside the exact 12-kind or nine-kind closed vocabulary.
- Pipeline decisions depend on run IDs, time, persistence, DBOS, attempts, leases,
  retries, authorization, resolved bindings, or other host state.
- A deep import, broad barrel, forbidden dependency, value/type cycle, or unresolved
  import bypasses the approved DAG.
- Observable semantics lack behavior or contract coverage at the owning boundary.
- The 103-row ownership matrix has a gap, duplicate, extra ID, or owner-count drift.
- Verification failures or warnings are suppressed.

## Required evidence

- `corepack pnpm verify` passes on the reviewed tree.
- Publication-block verification proves the private manifest, absent public exports,
  absent production dependencies, absent release workflows, and minimal source state.
- Workflow and shell conditional checks pass when those files change.
- The matrix contains exactly 103 unique IDs with compiler 22, kernel 32, core 7, and run
  42; evidence counts remain pipeline 54 and host/cross-package 49.
- CI, configured Sonar analysis, and valid review threads are green on the same exact
  head after publication to a review branch.
