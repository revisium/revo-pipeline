# Verification Contract

Requirements: Node.js `>=24.11.1 <25` and pnpm `11.13.0` through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`verify` is the required local gate. It checks formatting, strict types, lint, coverage,
the dependency graph, build/package structure, declarations, and executable consumer
behavior.

Package verification removes `dist`, performs one normal lifecycle pack, and checks its
exact file inventory. It runs exact-pinned publint `0.3.21` and Are the Types Wrong CLI
`0.18.5`, installs the tarball into a clean external project without linking the
checkout, type-checks the public entrypoints, and executes the tracked quick-start plus
compact runtime and negative-import probes.

Useful focused commands:

```bash
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm exec vitest run test/foundation test/source test/materialization
corepack pnpm exec vitest run test/program test/compiler test/kernel
corepack pnpm exec vitest run test/architecture test/package
corepack pnpm verify:architecture
corepack pnpm build
corepack pnpm verify:package
```

Run `actionlint` for workflow changes, `bash -n scripts/*.sh` for shell changes, and
`corepack pnpm audit --prod` for manifest or dependency changes.

For prerelease metadata changes, verify the publish payload without registry mutation:

```bash
npm publish --dry-run --tag alpha --access public
```

Actual publication remains a separate, explicitly approved human action.

Before handoff also run:

```bash
test -d src/program
test -d src/compiler
test -d src/kernel
test ! -d src/extensions
test "$(ls -1 .github/workflows | sort | tr '\n' ' ')" = "ci.yml npm-publish.yml release-train.yml "
git diff --check
```

On pull requests, CI waits for the Sonar quality gate and inspects open issues through
the Sonar API. On `master` and `release/**` pushes, CI uploads the analysis without
scanner-side quality-gate waiting or branch issue API polling. For every release push,
the provider-owned `SonarCloud Code Analysis` check must exist and pass on the exact
release SHA before tagging or publication. A missing, pending, failed, or mismatched-SHA
provider check blocks the release. After push, also verify CI and review threads against
the same exact head. Missing provider access is skipped or blocked, never passed.
