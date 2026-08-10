# Pipeline Canonicalization v1

- Status: Draft
- Version: 1.0.0-draft
- Target packages: `@revisium/revo-pipeline`, `@revisium/revo-pipeline/kernel`

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, and
**MAY** in this document are to be interpreted as described in BCP 14 (RFC 2119 and
RFC 8174) when, and only when, they appear in all capitals.

## Scope

This specification defines normalization, RFC 8785 bytes, digest domains, and golden
vectors for every public hashed artifact. It defines no `planDigest`. These APIs remain
Draft and unavailable until `rp-06`.

## Validated canonical domain

Canonicalization MUST run only after exact TypeBox and semantic validation. It MUST
reject unknown fields/kinds/versions, duplicate canonical keys, invalid references,
unpaired surrogates, non-NFC strings, custom prototypes, accessors, sparse arrays,
symbols, functions, `undefined`, and non-portable numbers.

All strings and object keys MUST already be NFC. Validation rejects canonical-key
collisions; serialization does not normalize. Numbers are finite safe integers and `-0`
is normalized to `0`. Diagnostics MUST identify only stable code/path and MUST NOT render
rejected values, prompts, secret references, binding data, or object excerpts.

Schema-declared keyed sets MUST normalize into Unicode code-point key order. Ordered
arrays preserve order. Object property order is never semantic. Program modules,
regions, nodes, requirements, provenance, state frames, pending/resolved operations,
command targets, and map results use the ordering declared by their owning specification.

## Serialization and hash preimage

Normalized data MUST serialize with RFC 8785 JSON Canonicalization Scheme to UTF-8 with
no BOM or whitespace. Implementations MUST use exact `canonicalize@3.0.0` behavior or
prove byte equality for every vector. They MUST use SHA-256 from the platform crypto
implementation; Node uses `node:crypto`.

For canonical payload bytes `P` and ASCII domain `D`, the hash preimage is the UTF-8
prefix:

```text
revo-pipeline-digest-v1\n<D>\n<decimal-byte-length-of-P>\n
```

followed immediately by `P`. Decimal length has no sign or leading zero, except zero is
`0`. A digest is exactly `sha256:` plus 64 lowercase hexadecimal characters. Hashes MUST
NOT be truncated.

## Fixed domains and payloads

| Domain                        | Exact payload                                                          |
| ----------------------------- | ---------------------------------------------------------------------- |
| `pipeline-source/v1`          | Complete normalized `PipelineSourcePackage`                            |
| `pipeline-materialization/v1` | Complete normalized `ProfileMaterialization`, including `sourceDigest` |
| `pipeline-program/v1`         | `{program, provenance, requirements}`                                  |
| `pipeline-ir-id/v1`           | `{loweringRole, ordinal, sourcePath}`                                  |
| `pipeline-frame-key/v1`       | One exact `FrameKeyPayload`                                            |
| `pipeline-command-key/v1`     | `{kind, ref}`                                                          |
| `pipeline-event/v1`           | Complete normalized `PipelineEvent`                                    |

`sourceDigest` excludes materialization. `materializationDigest` pins source.
`programDigest` covers the complete compiler bundle: program topology (including both
upstream digests), requirements, and provenance. Exact executor
binding/model/tool/permission/retry changes do not affect it.

Frame keys, IR IDs, command keys, and event digests use their dedicated domains and the
same preimage construction. Object identity, insertion order, local path, timestamp,
runtime ID, attempt, host, or environment MUST NOT influence any digest.

`planDigest` covers program plus exact bindings/policies and is core/run-owned.
`revo-pipeline` MUST NOT define, compute, export, or validate it.

## Required golden vectors

The following vectors are normative. Payload text shown is the exact RFC 8785 UTF-8
payload after the prefix.

### Synthesized direct IR ID

Domain: `pipeline-ir-id/v1`

```json
{ "loweringRole": "direct", "ordinal": 0, "sourcePath": "/modules/0/region/nodes/0" }
```

- payload byte length: `78`
- digest:
  `sha256:0850c1cd1ae717ed79e795935ed929b426fbae40e5a81b64604b7d0a92467761`

### Consensus participant zero IR IDs

For source path `/modules/0/region/nodes/0`, the exact A3 role/ordinal vectors are:

| Structural value | Lowering role                  | Ordinal | Payload bytes | Digest                                                                    |
| ---------------- | ------------------------------ | ------- | ------------- | ------------------------------------------------------------------------- |
| parallel         | `consensusParallel`            | 0       | 89            | `sha256:b7398c2a4268cee28f7cb358b4acc06b79f0a5c1a8f07c8a3d92897b42117bf7` |
| region           | `consensusParticipantRegion`   | 0       | 98            | `sha256:91e07101b490bc0987f52616d63ccf0a289bae4318f7fdb211d3e95f60c30c1c` |
| activity         | `consensusParticipantActivity` | 0       | 100           | `sha256:bdede9d2cc0316cc0babe56bf55853fd3981145f98e6c4bb9f78b64ec998bae2` |
| vote end         | `consensusParticipantExit`     | 0       | 96            | `sha256:4b1d2754eac24b6ef19c2c04cba7a7b67a9f465eeed370a3cefe88a18051d6ed` |
| failed end       | `consensusParticipantExit`     | 1       | 96            | `sha256:53a38e0505c702478d3031cc7318c17f0f9c6193e74158ce07ad5ed17d0e6379` |
| cancelled end    | `consensusParticipantExit`     | 2       | 96            | `sha256:6a551a1ac0ba9513ef10235e8aba6b81ee9a0735b1cecaaeced3eee225897718` |
| choice           | `consensusChoice`              | 0       | 87            | `sha256:6519dffd7a4ec877bd5193c52b3668a67542c497627a1e42c4c77605fd8fd633` |

Each payload is exactly `{loweringRole,ordinal,sourcePath}` under domain
`pipeline-ir-id/v1`. Participant `i > 0` changes the participant-region/activity
ordinal to `i` and the three exit ordinals to `3*i..3*i+2`. Full Program golden fixtures
MUST include required `ProgramVoteBranch.input`, all participant regions/ends, and their
provenance; pre-A3 digest expectations are invalid rather than aliases.

### Root frame key

Domain: `pipeline-frame-key/v1`

```json
{
  "kind": "rootRegion",
  "parentFrameKey": null,
  "regionId": "sha256:1111111111111111111111111111111111111111111111111111111111111111"
}
```

- payload byte length: `128`
- digest:
  `sha256:2c6bc1ea876c7f591aa19f1477e1f9da47e22a0cf83b567f6bc5b9568774f61b`

### Root-frame activity command key

Domain: `pipeline-command-key/v1`

```json
{
  "kind": "dispatchActivity",
  "ref": {
    "frameKey": "sha256:2c6bc1ea876c7f591aa19f1477e1f9da47e22a0cf83b567f6bc5b9568774f61b",
    "nodeId": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    "programDigest": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  }
}
```

- payload byte length: `293`
- digest:
  `sha256:843e4452009d1a2c365449a902a44f846ad0b3ea54271db4fff2ba7e79987aae`

Implementations MUST also ship fixtures for every domain, every `FrameKeyPayload` kind,
non-empty cancellation target set, source/materialization/program lineage, and event
replay. The three vectors above prevent divergent prefix, JCS order, or truncation rules;
the remaining fixture files prevent contract drift.

## Required edge coverage

Conformance MUST compare exact bytes/digests for property permutations, keyed-set
permutations, ordered arrays, composed/astral Unicode, rejected decomposed/unpaired
strings, minimum/maximum safe integers, normalized `-0`, rejected fractional/unsafe
numbers, escaping, non-ASCII keys, all domains, and JSON round trips.

Canonicalization/hashing MUST be bounded by validated artifact limits. It MUST NOT hash
unvalidated executor output, secret material, provider responses, or arbitrary host
objects. Failures expose fixed codes and paths only, preventing diagnostic/value
side-channels across the pipeline/core/run boundary.
