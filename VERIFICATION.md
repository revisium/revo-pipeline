# Verification Contract

Requirements: Node.js `>=24.11.1 <25` and pnpm 11.13.0 through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`verify` is the required local gate. It runs Oxlint and dependency-cruiser exactly once,
and checks formatting, types, test routing,
behavior and architecture tests, production coverage, characterization, build, package
contents, declarations, and isolated packed consumers.

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
