# ADR 0012: Alpha prerelease publication

- Status: Accepted
- Amends: ADR 0011

## Context

The exact Draft package boundary is useful to external evaluators, but distributing it
must not imply compatibility or downstream readiness.

## Decision

The under-development package may be published only as a prerelease under the npm
`alpha` tag. Every such release remains Draft and unstable, carries no compatibility
guarantee, and does not attest `revo-core` or host-runtime readiness.

## Alternatives Considered

- Keep evaluation limited to local and CI-built tarballs.
- Treat the current API as stable before its contracts are accepted.

## Consequences

External consumers can opt into the exact package boundary. The accepted downside is
that alpha consumers may need to change their code without compatibility support.

## Rollback

Stop issuing alpha prereleases. Existing immutable prereleases remain unstable
evaluation artifacts and gain no support guarantee.
