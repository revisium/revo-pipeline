# Verification Contract

Repository scripts are authoritative. Missing credentials or provider access is skipped
or blocked, never passed.

## Environment

- Node.js `>=24.11.1 <25`; `.nvmrc` is the baseline.
- pnpm 11.13.0 through Corepack.
- Install with `corepack pnpm install --frozen-lockfile`.

## Primary gate

```bash
corepack pnpm verify
```

It covers formatting, strict TypeScript 7, type-aware Oxlint, exhaustive test routing,
the architecture harness, product/package/characterization tests under one Vitest v8
coverage run, architecture positive/negative proof, ESM/declaration build, `publint`,
and exact one-tarball ATTW/content/isolated ESM/strict TS/runtime and type-level
deep-import proof. Production coverage is the complete `src` boundary; structural
validators are exercised by their mutant harness and against the exact repository tree
by the direct architecture gate.

| Capability              | Command                                 |
| ----------------------- | --------------------------------------- |
| Format                  | `corepack pnpm format:check`            |
| Typecheck               | `corepack pnpm typecheck`               |
| Lint                    | `corepack pnpm lint`                    |
| Focused developer tests | `corepack pnpm test`                    |
| Test routing            | `corepack pnpm verify:test-routing`     |
| Architecture harness    | `corepack pnpm test:harness`            |
| Product coverage        | `corepack pnpm test:cov`                |
| Coverage boundary       | `corepack pnpm verify:product-coverage` |
| Characterization corpus | `corepack pnpm verify:characterization` |
| Architecture            | `corepack pnpm verify:architecture`     |
| Build                   | `corepack pnpm build`                   |
| Package                 | `corepack pnpm verify:package`          |

The primary gate executes all 37 test files and 985 tests exactly once: 25 files /
465 tests in the coverage route and 12 files / 520 tests in the architecture harness.
Standalone unit, package, and characterization commands remain available for focused
development but are not called again by `verify`.

## Conditional gates

- GitHub workflow changes: `actionlint`.
- Shell changes: `bash -n scripts/*.sh`.
- Dependency changes: `corepack pnpm audit --prod`.
- Architecture changes: inspect `.oxlintrc.architecture.json`, run the architecture
  verifier, and confirm every exact negative probe fails for the intended rule and is
  removed even after failure.
- Release/package changes: run `verify:package`; use a temporary directory for any
  additional tarball inspection.

## Remote gates

Sonar is a required remote provider gate. CI blocks explicitly when `SONAR_TOKEN` is absent
or authenticated provider access fails; a skipped scan or unauthenticated issue query is not a
passing result. Pull requests check out and analyze `github.event.pull_request.head.sha`; branch
and manual runs analyze `github.sha`. Both modes pass explicit Sonar scope and revision
parameters, wait up to 300 seconds for the quality gate, verify the provider's latest analysis
revision is the expected SHA, and then fail on any scoped open issue.

GitHub withholds repository secrets from fork pull requests and Dependabot-triggered workflows.
External fork and Dependabot pull requests are therefore unsupported by this mandatory provider
gate, and rerunning the same untrusted event does not make it trusted. Never expose the secret to
fork-controlled code. After reviewing the external changes, a maintainer must recreate or
cherry-pick them onto a trusted same-repository branch whose workflow and scripts have also been
reviewed; only that trusted branch's exact analysis revision can supply merge evidence.

Sonar measures production coverage from `src` only (`sonar.sources=src`); `test` is registered
as test code and repository scripts are verified by the primary local gate, not counted as
production coverage. The scanner deliberately has no broad source, coverage, or duplication
exclusions. Add a future exclusion only when it names a concrete non-production source path and
its reason is documented and tested.

After push, inspect CI and Sonar on the exact head, then all valid review threads.
Release validation may create an artifact but never publishes. Do not merge, tag,
release, or publish without the corresponding explicit approval.
