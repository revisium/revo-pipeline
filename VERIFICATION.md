# Verification Contract

Requirements: Node.js `>=24.11.1 <25` and pnpm 11.13.0 through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`verify` is the required local gate. It checks formatting, types, lint, behavior
tests with coverage, dependency-cruiser architecture rules, build, and the packed
package via publint and `@arethetypeswrong/cli`.

Useful focused commands:

```bash
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm verify:architecture
corepack pnpm verify:package
```

Run `actionlint` for workflow changes, `bash -n scripts/*.sh` for shell changes, and
`corepack pnpm audit --prod` for dependency changes.

After push, verify CI, the required Sonar quality gate, and review threads against the
exact head. Missing provider credentials or access is blocked or skipped, never passed.
