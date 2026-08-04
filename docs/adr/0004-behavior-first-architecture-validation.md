# ADR 0004: Behavior-first architecture validation

- Status: Accepted
- Date: 2026-08-02

## Decision

Supported forbidden imports, static/export-from `.js` extensions, and the 80-line
production callable limit are owned by pinned Oxlint. Layer direction, private/root
boundaries, production escapes, host/external imports, resolution, and all transitive
cycles are owned by pinned dependency-cruiser. Observable
compiler, graph, and decision guarantees are owned by behavior and property
tests; package shape and type resolution are owned by publint and
`@arethetypeswrong/cli` against the packed artifact.

Exact call spelling, statement order, aliases, dominance, same-binding identity,
one-export leaves, exact incidental inventories, and internal barrel source shape are
not architecture contracts. All custom AST/source parsers are retired.

dependency-cruiser is adopted narrowly for boundaries Oxlint cannot express clearly.
Version 18.1.1 supports TypeScript versions below 7, so its package extension pins a
private TypeScript 6.0.3 parser while the project continues to use TypeScript 7.0.2.
Keeping the parser dependency adjacent to dependency-cruiser prevents architecture
validation from constraining the project's compiler version.

## Consequences

`verify` invokes Oxlint once and dependency-cruiser once. Architecture
failures describe stable contracts instead of implementation spelling. The mandatory
callable limit remains local: 80 formatted physical lines pass and 81 fail.
