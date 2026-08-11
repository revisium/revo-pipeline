import {
  PIPELINE_LIMITS,
  appendJsonPointer,
  createPortableNormalizationSession,
  type DiagnosticCollector,
  type JsonPointer,
} from '../../foundation/index.js';
import {
  EmptyObjectSchema,
  type PipelineSourceModule,
  type PipelineSourcePackage,
  type SourceRegion,
} from '../contracts/index.js';
import { nonEmptyTuple, validateIdentifier } from '../internal.js';
import { normalizeValueSchema } from '../value-schema/index.js';
import { normalizeKeyed, type NormalizationContext } from './common.js';
import { normalizeSourceNode } from './nodes.js';

export const normalizeRegion = (
  region: SourceRegion,
  path: JsonPointer,
  context: NormalizationContext,
  regionDepth: number,
): SourceRegion => {
  if (regionDepth > PIPELINE_LIMITS.sourcePackage.nestingDepth) {
    context.collector.add('BOUND_EXCEEDED', path);
  }
  validateIdentifier(region.key, appendJsonPointer(path, 'key'), context.collector);
  validateIdentifier(region.entry, appendJsonPointer(path, 'entry'), context.collector);
  const exitsPath = appendJsonPointer(path, 'exits');
  const exits = nonEmptyTuple(
    normalizeKeyed(region.exits, ({ outcome }) => outcome, exitsPath, context.collector).map(
      (exit, index) => {
        const exitPath = appendJsonPointer(exitsPath, String(index));
        validateIdentifier(exit.outcome, appendJsonPointer(exitPath, 'outcome'), context.collector);
        return Object.freeze({
          ...exit,
          outputSchema: normalizeValueSchema(
            exit.outputSchema,
            appendJsonPointer(exitPath, 'outputSchema'),
            context.collector,
          ),
        });
      },
    ),
  );
  const nodesPath = appendJsonPointer(path, 'nodes');
  const nodes = nonEmptyTuple(
    normalizeKeyed(region.nodes, ({ key }) => key, nodesPath, context.collector).map(
      (node, index) =>
        normalizeSourceNode(
          node,
          appendJsonPointer(nodesPath, String(index)),
          context,
          regionDepth,
          normalizeRegion,
        ),
    ),
  );
  return Object.freeze({
    ...region,
    inputSchema: normalizeValueSchema(
      region.inputSchema ?? EmptyObjectSchema,
      appendJsonPointer(path, 'inputSchema'),
      context.collector,
    ),
    outputSchema: normalizeValueSchema(
      region.outputSchema,
      appendJsonPointer(path, 'outputSchema'),
      context.collector,
    ),
    exits: Object.freeze(exits),
    nodes: Object.freeze(nodes),
  });
};

const normalizeModule = (
  module: PipelineSourceModule,
  path: JsonPointer,
  context: NormalizationContext,
): PipelineSourceModule => {
  validateIdentifier(module.key, appendJsonPointer(path, 'key'), context.collector);
  return Object.freeze({
    ...module,
    inputSchema: normalizeValueSchema(
      module.inputSchema,
      appendJsonPointer(path, 'inputSchema'),
      context.collector,
    ),
    outputSchema: normalizeValueSchema(
      module.outputSchema,
      appendJsonPointer(path, 'outputSchema'),
      context.collector,
    ),
    region: normalizeRegion(module.region, appendJsonPointer(path, 'region'), context, 0),
  });
};

export const normalizeSourcePackage = (
  source: PipelineSourcePackage,
  collector: DiagnosticCollector,
): PipelineSourcePackage => {
  validateIdentifier(source.key, '/key', collector);
  validateIdentifier(source.entryModule, '/entryModule', collector);
  const context: NormalizationContext = {
    collector,
    portable: createPortableNormalizationSession(),
  };
  const modulesPath: JsonPointer = '/modules';
  const modules = nonEmptyTuple(
    normalizeKeyed(source.modules, ({ key }) => key, modulesPath, collector).map((module, index) =>
      normalizeModule(module, appendJsonPointer(modulesPath, String(index)), context),
    ),
  );
  return Object.freeze({ ...source, modules: Object.freeze(modules) });
};
