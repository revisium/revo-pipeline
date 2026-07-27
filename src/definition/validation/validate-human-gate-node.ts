import { PIPELINE_LIMITS } from '../../policy/index.js';
import type { DefinitionValidationContext } from './definition-validation-context.js';

type RecordValue = Record<string, unknown>;

export const validateHumanGateNode = (
  node: RecordValue,
  path: string,
  context: DefinitionValidationContext,
): number => {
  context.unknownFields(node, ['key', 'kind', 'resolutions', 'subject'], path);
  context.requireDisplayString(node.subject, `${path}/subject`);
  if (
    !context.requireArray(
      node.resolutions,
      `${path}/resolutions`,
      PIPELINE_LIMITS.definition.resolutionsPerNode,
    )
  ) {
    return 0;
  }
  if (node.resolutions.length === 0) {
    context.addFault(
      'DEF_GATE_RESOLUTION',
      `${path}/resolutions`,
      'Resolutions must be non-empty.',
    );
  }
  const names = new Set<string>();
  node.resolutions.forEach((entry, index) => {
    const routePath = `${path}/resolutions/${index}`;
    if (!context.isRecord(entry)) {
      context.addFault('DEF_TYPE', routePath, 'Expected gate resolution.');
      return;
    }
    context.unknownFields(entry, ['resolution', 'to'], routePath);
    if (context.requireName(entry.resolution, `${routePath}/resolution`)) {
      if (names.has(entry.resolution)) {
        context.addFault('DEF_GATE_RESOLUTION', `${routePath}/resolution`, 'Duplicate resolution.');
      }
      names.add(entry.resolution);
    }
    context.requireKey(entry.to, `${routePath}/to`);
  });
  return node.resolutions.length;
};
