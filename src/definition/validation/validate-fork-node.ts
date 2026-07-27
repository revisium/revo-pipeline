import { PIPELINE_LIMITS } from '../../policy/index.js';
import type { DefinitionValidationContext } from './definition-validation-context.js';

type RecordValue = Record<string, unknown>;

export const validateForkNode = (
  node: RecordValue,
  path: string,
  context: DefinitionValidationContext,
): void => {
  context.unknownFields(node, ['branches', 'join', 'key', 'kind'], path);
  context.requireKey(node.join, `${path}/join`);
  if (
    !context.requireArray(
      node.branches,
      `${path}/branches`,
      PIPELINE_LIMITS.definition.forkBranchesPerNode,
    )
  ) {
    return;
  }
  if (node.branches.length < 2) {
    context.addFault('DEF_FORK_ARITY', `${path}/branches`, 'Fork requires at least two branches.');
  }
  const names = new Set<string>();
  node.branches.forEach((entry, index) => {
    const branchPath = `${path}/branches/${index}`;
    if (!context.isRecord(entry)) {
      context.addFault('DEF_TYPE', branchPath, 'Expected fork branch.');
      return;
    }
    context.unknownFields(entry, ['entry', 'exit', 'name'], branchPath);
    if (context.requireName(entry.name, `${branchPath}/name`)) {
      if (names.has(entry.name)) {
        context.addFault('DEF_DUPLICATE', `${branchPath}/name`, 'Duplicate fork branch.');
      }
      names.add(entry.name);
    }
    context.requireKey(entry.entry, `${branchPath}/entry`);
    context.requireKey(entry.exit, `${branchPath}/exit`);
  });
};
