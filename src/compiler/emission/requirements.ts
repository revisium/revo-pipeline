import {
  canonicalizeOwnedValue,
  compareUnicodeCodePoints,
  type DiagnosticCollector,
  type JsonPointer,
} from '../../foundation/index.js';
import type {
  ProgramRequirement,
  ProgramRequirements,
  RequirementProvenance,
  NodeProvenance,
} from '../../program/index.js';
import type { RequirementUse } from '../lowering/contracts.js';
import type { ProgramStructure } from './structure.js';

export type EmittedRequirements = {
  readonly requirements: ProgramRequirements;
  readonly provenance: readonly RequirementProvenance[];
};

const uniquePaths = (paths: readonly JsonPointer[]): readonly JsonPointer[] =>
  Object.freeze([...new Set(paths)].sort(compareUnicodeCodePoints));

export const emitRequirements = (
  uses: readonly RequirementUse[],
  structure: ProgramStructure,
  nodeProvenance: readonly NodeProvenance[],
  collector: DiagnosticCollector,
): EmittedRequirements => {
  const usesByKey = Map.groupBy(uses, ({ requirement }) => requirement.key);
  const activityKeys = new Set(
    structure.activityRequirements.map(({ requirementKey }) => requirementKey),
  );
  const sourcePathsByNodeId = new Map(
    nodeProvenance.map(({ programNodeId, sourcePath }) => [programNodeId, sourcePath]),
  );
  const entries: ProgramRequirement[] = [];
  const provenance: RequirementProvenance[] = [];

  for (const key of [...usesByKey.keys()].sort(compareUnicodeCodePoints)) {
    const matching = usesByKey.get(key) ?? [];
    const first = matching[0];
    if (first === undefined) {
      continue;
    }
    const declarations = new Set(
      matching.map(({ requirement }) => canonicalizeOwnedValue(requirement).text),
    );
    if (declarations.size > 1) {
      collector.add('REQUIREMENT_CONFLICT', first.sourcePath);
    }
    if (!activityKeys.has(key)) {
      collector.add('REQUIREMENT_UNUSED', first.sourcePath);
    }
    entries.push(first.requirement);
    const materializationPaths = matching.flatMap(({ materializationPath }) =>
      materializationPath === null ? [] : [materializationPath],
    );
    const sourcePaths = uniquePaths(matching.map(({ sourcePath }) => sourcePath));
    const [firstPath, ...otherPaths] = sourcePaths;
    if (firstPath === undefined) {
      throw new TypeError('Expected requirement provenance.');
    }
    const sourcePathTuple: [JsonPointer, ...JsonPointer[]] = [firstPath, ...otherPaths];
    provenance.push(
      Object.freeze({
        requirementKey: key,
        sourcePaths: Object.freeze(sourcePathTuple),
        materializationPaths: uniquePaths(materializationPaths),
      }),
    );
  }

  const emittedKeys = new Set(entries.map(({ key }) => key));
  for (const { nodeId, requirementKey } of structure.activityRequirements) {
    if (!emittedKeys.has(requirementKey)) {
      collector.add('REQUIREMENT_MISSING', sourcePathsByNodeId.get(nodeId) ?? '');
    }
  }

  return Object.freeze({
    requirements: Object.freeze({
      schemaVersion: 'pipeline-requirements/v1',
      entries: Object.freeze(entries),
    }),
    provenance: Object.freeze(provenance),
  });
};
