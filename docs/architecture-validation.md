# Architecture validation evidence

Architecture validation composes standard tools and observable tests; it contains no
custom AST or source parser.

| Boundary or risk                                                                    | Owner and evidence                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| supported forbidden imports, `.js` extensions, 80-line production callables         | pinned Oxlint plus `oxlint-architecture-fixtures.test.ts`                                                                             |
| layers, private/root boundaries, escapes, host/external imports, resolution, cycles | pinned dependency-cruiser plus table-driven `dependency-cruiser-fixtures.test.ts`                                                     |
| exact root declaration and type-only `spec`/`errors` emitted JavaScript             | SHA-256/full-text package contract plus `public-contract.test.ts` mutation evidence                                                   |
| package root, runtime exports, zero runtime dependencies                            | `source-entrypoints.test.ts` and public type tests                                                                                    |
| package exports, declarations, deep-import denial, lifecycle and permissions        | packed consumer/package verification tests                                                                                            |
| graph isolation and repeated work accounting                                        | `keeps A/B/A kernel builds isolated without module-level cache state` and `charges duplicate reconstructed kernel work independently` |
| accepted decode/decision/reduction graph agreement                                  | `keeps accepted decode, decision, and reduction topology/indexes in agreement`                                                        |
| graph differential behavior and operation budgets                                   | named tests under `graph kernel proof matrix`                                                                                         |
| reducer bounds and lifecycle precedence                                             | reducer frontier and command-domain matrix tests                                                                                      |

dependency-cruiser is pinned as a development-only dependency and adds no runtime
dependency. The obsolete custom graph-flow, reducer-shape, module/source-metric, and
package-verifier AST validators are retired. Exact incidental inventories,
one-export-per-leaf, and internal source spelling are intentionally not checked.
dependency-cruiser is the sole cycle owner. Oxlint's pinned extension rule enforces the
static and export-from forms it supports; project TypeScript/package compilation rejects
extensionless literal dynamic imports and import-type expressions.

## Timing protocol

Raw observations are stored in `docs/evidence/architecture-validation-timings.csv`.
The human accepted a limited alternating 5A/5B mixed cold/warm observation in place of
the original 10-cold/30-warm protocol. It compared the archived pre-upstream candidate
against its baseline. It contains one process-cold sample and four warm samples per
variant, ordered cold `A,B` followed by two `A,B,B,A` blocks. OS page-cache state was
uncontrolled. This is explicitly not the original protocol.

Statistics use all five observations for each variant. Median is the ordinary sample
median. p95 uses linear interpolation at `(n - 1) * 0.95` (Hyndman-Fan type 7). Ratios
are candidate divided by baseline, so a smaller value is faster. For focused architecture:

- baseline median 32.386 s and p95 33.933 s;
- candidate median 5.829 s and p95 6.002 s;
- candidate/baseline median ratio 0.1800 and p95 ratio 0.1769.

The candidate full `verify` completed with exit 0, including socket/FIFO and nested-tool
checks, and the production audit completed with exit 0 and no known vulnerabilities.
The archived baseline full `verify` reached the per-sample bound at 180.116 s with exit 124. The remaining full-verify samples were not run, and no full-verify timing ratio is
reported.

After adaptation to upstream native-script definitions, a separate single observation
completed in 6.15 s while cruising 304 modules and 910 dependencies. It is not mixed into
the archived A/B statistics and does not establish a new ratio.
