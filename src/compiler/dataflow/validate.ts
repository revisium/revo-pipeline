import {
  EmptyObjectSchema,
  appendJsonPointer,
  createDiagnosticCollector,
  type JsonPointer,
  type PipelineDiagnostic,
} from '../../foundation/index.js';
import type { ValidatedProfileMaterialization } from '../../materialization/index.js';
import type { PipelineSourcePackage, SourceRegion } from '../../source/index.js';
import type { LinkedSource } from '../linking/index.js';
import { indexAgentSelections } from './agent-selections.js';
import { validateNodeDataflow } from './node-validation.js';
import { analyzeRouteFacts } from './route-graph.js';
import { createSchemaResolver, type SelectorEnvironment } from './schema-resolver.js';

export type DataflowResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostics: readonly PipelineDiagnostic[] };

export const validateDataflow = (
  source: PipelineSourcePackage,
  materialization: ValidatedProfileMaterialization,
  linked: LinkedSource,
): DataflowResult => {
  const collector = createDiagnosticCollector();
  const agentSelections = indexAgentSelections(materialization);

  const validateRegion = (
    region: SourceRegion,
    path: JsonPointer,
    environment: SelectorEnvironment,
  ): void => {
    const nodePaths = new Map<string, JsonPointer>(
      region.nodes.map((node, index) => [
        node.key,
        appendJsonPointer(appendJsonPointer(path, 'nodes'), String(index)),
      ]),
    );
    const selectedStrategy = (node: (typeof region.nodes)[number]) => {
      if (node.kind !== 'agent') {
        return undefined;
      }
      const selection = agentSelections.get(nodePaths.get(node.key) ?? '')?.slot.selection;
      return node.strategies.find(({ kind }) => kind === selection?.strategy);
    };
    const facts = analyzeRouteFacts(region, selectedStrategy);
    const resolver = createSchemaResolver({
      environment,
      facts,
      nodePaths,
      agentSelections,
      collector,
    });
    for (const node of region.nodes) {
      if (!facts.isReachable(node.key)) {
        continue;
      }
      const nodePath = nodePaths.get(node.key) ?? path;
      validateNodeDataflow(node, region, {
        path: nodePath,
        environment,
        resolver,
        collector,
        linked,
        validateChild: validateRegion,
      });
    }
  };

  for (const [moduleIndex, module] of source.modules.entries()) {
    validateRegion(module.region, `/modules/${moduleIndex}/region`, {
      moduleInput: module.inputSchema,
      scopeInput: module.region.inputSchema ?? EmptyObjectSchema,
    });
  }
  const diagnostics = collector.finalize();
  return diagnostics.length === 0 ? { ok: true } : { ok: false, diagnostics };
};
