# Verification Contract

Requirements: Node.js `>=24.11.1 <25` and pnpm 11.13.0 through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`verify` is the required local gate. It checks formatting, types, lint, tests with
coverage, dependency-cruiser architecture rules, the TypeScript build, and the
fail-closed publication block.

Useful focused commands:

```bash
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm verify:architecture
corepack pnpm verify:package
```

`verify:package` builds the inert module and validates the blocked manifest. It does not
pack or validate a consumer API because no package API exists before `rp-06`.

Run `actionlint` for workflow changes, `bash -n scripts/*.sh` for shell changes, and
`corepack pnpm audit --prod` for manifest or dependency changes. Also run
`git diff --check` and the reset-specific absence/count audits when the physical reset
or lifecycle documents change.

After push, verify CI, the required Sonar quality gate, and review threads against the
exact head. Missing provider credentials or access is blocked or skipped, never passed.
