# Repository Structure

`@revisium/revo-pipeline` is an under-development prerelease ESM package with three
curated consumer facades and six dependency layers.

```text
architecture/layers.json  six-layer dependency source of truth
src/index.ts               exact authoring/compiler facade
src/foundation/            portable values, schemas, canonicalization, digests
src/source/                source contracts, normalization, semantics
src/materialization/       profile materialization contracts and validation
src/program/               Program contracts, analysis, admission, bundle digest
src/compiler/              linking, dataflow, bounds, lowering, emission
src/kernel/public.ts       exact pure-machine facade
src/kernel/                machine contracts and execution
src/execution-plan/        ADR 0013 execution-plan integration facade
test/                      behavior, architecture, package, and contract suites
docs/specs/                six Draft normative contracts
docs/adr/                  accepted architecture decisions
```

`architecture/layers.json` records only dependency layers and their edges. Public
facades are not layers. Cross-layer imports use the target layer's curated `index.ts`;
layers never import the root facade. The root facade imports only the foundation,
source, materialization, Program, and compiler indexes. The reserved `src/extensions`
directory must not exist.

`package.json` exposes only `.`, `./kernel`, and `./execution-plan`. It builds strict NodeNext JavaScript and
declarations under `dist/`, without source or declaration maps. The package is version
`0.2.0-alpha.1` and may be published publicly only under the npm `alpha` tag. It remains
Draft and unstable, with no compatibility or `revo-core`/host-runtime readiness claim.
Production dependencies are exactly `typebox@1.3.10` and `canonicalize@4.0.0`; no
workflow publishes from pull requests. Release-train transitions are manual; automated
npm publication requires an explicit version-matched alpha tag.

Direct cutover means there is no compatibility implementation or parallel API. See
[README](README.md), [architecture](docs/architecture.md), [verification](VERIFICATION.md),
and [review](REVIEW.md).
