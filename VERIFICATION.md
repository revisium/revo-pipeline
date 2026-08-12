# Verification Contract

Requirements: Node.js `>=24.11.1 <25` and pnpm 11.13.0 through Corepack.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`verify` is the required local gate. It checks formatting, types, lint, tests with
coverage, dependency-cruiser architecture rules, and the TypeScript build. Vitest owns
the foundation, source, materialization, Program, compiler, package, layer-manifest, and
documentation contracts.

Useful focused commands:

```bash
corepack pnpm format:check
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm exec vitest run test/foundation
corepack pnpm exec vitest run test/source test/materialization
corepack pnpm exec vitest run test/program test/compiler
corepack pnpm exec vitest run test/architecture test/docs test/package
corepack pnpm verify:architecture
corepack pnpm build
```

Package tests check the private ESM manifest, exact `typebox@1.3.10` and
`canonicalize@3.0.0` production dependencies, absent public fields, inert root, sole
`ci.yml` workflow, and the unconditional failing publish hook. They do not pack or
validate a consumer API because no package API exists before readiness acceptance.

Run `actionlint` for workflow changes, `bash -n scripts/*.sh` for shell changes, and
`corepack pnpm audit --prod` for manifest or dependency changes. Also run
`git diff --check` and the direct-cutover absence/count audits when layers, lifecycle
documents, vocabularies, or ownership evidence change. The required local layer audits are:

```bash
test -d src/program && test -d src/compiler
test ! -d src/kernel && test ! -d src/extensions
test "$(ls -1 .github/workflows)" = ci.yml
git diff --check
```

The focused suites also exercise hostile/revoked reflection, uncapped general portable
strings/keys, exact canonical byte edges, closed schema options and diagnostic codes,
runtime digest-domain rejection, representative dependency rules (including the resolved
crypto built-in allowance, categorical nonproduction rejection, and manifest-derived
production-package allowlist), plus concise package and layer contracts.

Normal verification structurally validates all 62 delivery-plan rows, derives coverage
of all 48 specification sections from the Draft files, resolves active suite references,
and checks the 103-row ownership partition `22/32/7/42`. The unchanged Draft specs remain
the source of truth for the 12 source kinds and nine IR kinds.

These are ordinary reviewed-change guardrails. They do not parse every source spelling
or prove resistance to a contributor who edits code, configuration, and verification
together.

After push, verify CI, the required Sonar quality gate, and review threads against the
exact head. Missing provider credentials or access is blocked or skipped, never passed.
