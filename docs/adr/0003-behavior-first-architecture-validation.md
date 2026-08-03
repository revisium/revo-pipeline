# ADR 0003: Behavior-first architecture validation

Status: Accepted

## Decision

Supported forbidden imports, static/export-from `.js` extensions, and the 80-line
production callable limit are owned by pinned Oxlint. Layer direction, private/root
boundaries, production escapes, host/external imports, resolution, and all transitive
cycles are owned by pinned dependency-cruiser. Observable
compiler, graph, reducer, and package lifecycle guarantees are owned by behavior,
property, differential, and packed-consumer tests.

The normalized root declaration is locked by an exact SHA-256 package contract with
addition, removal, alias, and type/value-phase mutation evidence. Emitted `spec` and
`errors` JavaScript must equal the compiler's empty-module output. These checks compare
artifacts as complete text and do not parse source syntax.

Exact call spelling, statement order, aliases, dominance, same-binding identity,
one-export leaves, exact incidental inventories, and internal barrel source shape are
not architecture contracts. All custom AST/source parsers are retired.

dependency-cruiser is adopted narrowly for boundaries Oxlint cannot express clearly.

## Consequences

`verify` invokes Oxlint once and dependency-cruiser once. Architecture
failures describe stable contracts instead of implementation spelling. The mandatory
callable limit remains local: 80 formatted physical lines pass and 81 fail.
