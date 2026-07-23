# revo-pipeline Release Train

Publication uses pinned shared workflows from `revisium/revisium-actions`; repository-local
version or publish scripts are not allowed.

## Rules

- Publish only after explicit approval.
- Run a dry release transition before write mode.
- Do not publish locally or directly from `master`.
- Do not create release branches or tags manually.
- Never reuse or overwrite a published version.
- Verify the exact packed artifact and a clean consumer.
- Update shared-workflow pins intentionally, never to a floating ref.

Before `1.0.0`, public API/behavior changes use a minor release and compatible fixes use
a patch. Use `alpha` or `rc` for consumer validation.

## Workflows

- `ci.yml`: pull requests, `master`, and `release/**`.
- `release.yml`: manual validation and artifact creation without publication.
- `release-train.yml`: approved version/branch/tag transitions.
- `npm-publish.yml`: exact SemVer tag publication.

Write-mode release trains require `RELEASE_BOT_CLIENT_ID` and
`RELEASE_BOT_PRIVATE_KEY`. npm publication requires `NPM_TOKEN`.

The initial stable tag is a separate administration action. For later releases: dry run,
review the computed branch/version/tag/channel, obtain approval, run write mode, wait for
tag publication, verify npm dist-tag, then install in a clean consumer.
