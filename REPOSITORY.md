# Repository Structure

`@revisium/revo-pipeline` is in a publication-blocked direct reset.

```text
src/index.ts          inert module with no runtime exports
scripts/              publication-block and local Sonar helpers
test/package/         publication-block and empty-surface tests
docs/specs/           six Draft normative contracts
docs/adr/             accepted direct-cutover decision
docs/conformance/     103-row intent ownership matrix
.github/workflows/    verification CI only; no release or publish workflow
```

`package.json` is private and has no `main`, `types`, `exports`, `files`,
`publishConfig`, production dependencies, or prepack hook. The fail-closed
`prepublishOnly` hook and `scripts/verify-publication-block.mjs` protect this state.

## Planned private layers

Implementation proceeds only through the sequential work items. The intended dependency
direction is:

```text
source -------------> foundation
materialization ----> foundation + source contracts
program ------------> foundation
compiler/linker ----> foundation + source + materialization + program
kernel -------------> foundation + program
extensions/tooling -> source + materialization + compiler (compile time only)
```

Every layer remains private. The root authoring/compiler manifest and narrow `./kernel`
machine manifest described by Conformance v1 are final `rp-06` surfaces, not reset
exports. No folder path becomes a public deep import.

The reset dependency-cruiser baseline enforces no cycles, keeps resolved local source
imports inside `src`, and rejects unresolved source imports. Work items add layer rules
only when the corresponding layer exists.

## Work-item sequence

`rp-00` reset/docs/block → `rp-01` foundation → `rp-02` source/materialization →
`rp-03` compiler/program/digests → `rp-04` base kernel → `rp-05` coordination/waits →
`rp-06` conformance/readiness.

Direct cutover means no compatibility layer or parallel implementation is allowed at
any point. The package remains nonpublishable until the `rp-06` gates and a later
separate publication approval.
