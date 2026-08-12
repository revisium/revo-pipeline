import { appendJsonPointer, type JsonPointer } from '../foundation/index.js';
import type {
  PipelineSourceModule,
  PipelineSourcePackage,
  SourceNode,
  SourceRegion,
} from '../source/index.js';

export type SourceNodeLocation = {
  readonly module: PipelineSourceModule;
  readonly path: JsonPointer;
  readonly node: SourceNode;
};

const childRegions = (
  node: SourceNode,
  path: JsonPointer,
): readonly { readonly region: SourceRegion; readonly path: JsonPointer }[] => {
  if (node.kind === 'parallel') {
    return node.branches.map((branch, index) => ({
      region: branch.region,
      path: `${path}/branches/${index}/region`,
    }));
  }
  if (node.kind === 'repeat' || node.kind === 'map') {
    return [{ region: node.body, path: appendJsonPointer(path, 'body') }];
  }
  return [];
};

const collectRegion = (
  module: PipelineSourceModule,
  region: SourceRegion,
  path: JsonPointer,
  nodes: SourceNodeLocation[],
): void => {
  for (const [nodeIndex, node] of region.nodes.entries()) {
    const nodePath = `${path}/nodes/${nodeIndex}` as JsonPointer;
    nodes.push(Object.freeze({ module, node, path: nodePath }));
    for (const child of childRegions(node, nodePath)) {
      collectRegion(module, child.region, child.path, nodes);
    }
  }
};

export type SourceLayout = {
  readonly nodes: readonly SourceNodeLocation[];
};

export const indexSourceLayout = (source: PipelineSourcePackage): SourceLayout => {
  const nodes: SourceNodeLocation[] = [];
  for (const [moduleIndex, module] of source.modules.entries()) {
    collectRegion(module, module.region, `/modules/${moduleIndex}/region`, nodes);
  }
  return Object.freeze({
    nodes: Object.freeze(nodes),
  });
};
