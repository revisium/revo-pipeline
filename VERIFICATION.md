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

It covers formatting, strict TypeScript 7, type-aware Oxlint, unit and package tests,
Vitest v8 coverage, architecture positive/negative proof, ESM/declaration build,
`publint`, and exact one-tarball ATTW/content/isolated ESM/strict TS/runtime and
type-level deep-import proof. Foundation coverage includes the owned structural
architecture validator.

| Capability   | Command                             |
| ------------ | ----------------------------------- |
| Format       | `corepack pnpm format:check`        |
| Typecheck    | `corepack pnpm typecheck`           |
| Lint         | `corepack pnpm lint`                |
| Tests        | `corepack pnpm test`                |
| Coverage     | `corepack pnpm test:cov`            |
| Architecture | `corepack pnpm verify:architecture` |
| Build        | `corepack pnpm build`               |
| Package      | `corepack pnpm verify:package`      |

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

After push, inspect CI and Sonar on the exact head, then all valid review threads.
Release validation may create an artifact but never publishes. Do not merge, tag,
release, or publish without the corresponding explicit approval.
