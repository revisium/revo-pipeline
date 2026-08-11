# Review Contract

Findings cite a concrete file and line, the violated contract, the risk, and the smallest
sufficient correction.

## Blocking findings

- The package can publish, exposes a runtime value, or contains a release/publish
  workflow before `rp-06`.
- `package.json` gains a public entrypoint, files manifest, publish configuration,
  prepack hook, or a production dependency other than exact `typebox@1.3.10` and
  `canonicalize@3.0.0` during `rp-01`.
- A Draft root or `./kernel` API is exposed before `rp-06`.
- An adapter, converter, dual reader, deprecated alias, compatibility package, hidden
  interpreter, or runtime node-kind plugin is introduced.
- Source or IR contains a kind outside the exact 12-kind or nine-kind closed vocabulary.
- Pipeline decisions depend on run IDs, time, persistence, DBOS, attempts, leases,
  retries, authorization, resolved bindings, or other host state.
- A deep import, broad barrel, forbidden dependency, value/type cycle, or unresolved
  import bypasses the approved DAG.
- `architecture/layers.json` drifts from the canonical seven records, a future layer
  directory appears early, an active layer is missing, or a layer/root import bypasses
  the manifest-derived rules.
- Foundation validation invokes an accessor, accepts non-NFC or unpaired Unicode,
  custom prototypes, cycles, sparse arrays, unsafe/fractional numbers, or exceeds a
  declared bound.
- Portable JSON incorrectly applies the 512-code-point display/diagnostic limit to
  general strings or object keys, or reflection failures from hostile/revoked proxies
  throw or expose trap details.
- The closed-object helper accepts schema structure outside `$id`, `title`, and
  `description`; invokes option accessors; or allows proxy failures to escape.
- Diagnostics accept a code outside the fixed catalog, an invalid JSON Pointer, an
  arbitrary message, extra fields, accessors, or proxy-backed entries.
- Canonicalization runs on rejected input, uses a digest domain outside the exact seven,
  omits the length-delimited prefix, truncates SHA-256, or introduces an `rp-06` public
  digest wrapper.
- The package stops being ESM, the resolved source graph adds a Node core dependency
  beyond the current crypto use or a classified nonproduction package, or dependency
  rules omit cycle, root/private, unresolved-local, DAG, production-package, or
  curated-index enforcement.
- `.github/workflows/` contains a release/publish workflow or anything beyond the
  reviewed `ci.yml` during `rp-01`.
- Observable semantics lack behavior or contract coverage at the owning boundary.
- The 103-row ownership matrix has a gap, duplicate, extra ID, or owner-count drift.
- Verification failures or warnings are suppressed.

## Required evidence

- `corepack pnpm verify` passes on the reviewed tree.
- Package tests check the private ESM manifest, absent public exports, exact two
  production dependencies, inert root, sole reviewed CI workflow, and failing publish
  hook.
- Foundation suites cover bounds, hostile portable input, identifiers and RFC 6901,
  the fixed diagnostic catalog/order/truncation/redaction, defensive TypeBox closure,
  exact RFC 8785 edge and round-trip bytes, runtime digest-domain rejection, and
  normative vectors.
- Architecture suites pin the active manifest/filesystem and use representative
  dependency-cruiser fixtures for the DAG, cycles, root/deep imports, resolution, Node
  core use, and resolved production-versus-development package boundaries.
- Workflow and shell conditional checks pass when those files change.
- The matrix contains exactly 103 unique IDs with compiler 22, kernel 32, core 7, and run
  42; evidence counts remain pipeline 54 and host/cross-package 49.
- The delivery plan contains 62 unique structurally valid rows, covers all 48
  specification sections, and resolves active suite path/marker references.
- CI, configured Sonar analysis, and valid review threads are green on the same exact
  head after publication to a review branch.

Local verification assumes a reviewed contributor change. It is not evidence that a
malicious committer cannot modify implementation, configuration, and checks together.
