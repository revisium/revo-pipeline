import {
  PIPELINE_LIMITS,
  appendJsonPointer,
  createDiagnosticCollector,
  type JsonPointer,
  type PipelineDiagnostic,
} from '../../foundation/index.js';
import type { PipelineSourcePackage } from '../../source/index.js';
import { indexSourceLayout } from '../source-layout.js';
import type { LinkedCall, LinkedSource } from './contracts.js';

export type LinkResult =
  | { readonly ok: true; readonly value: LinkedSource }
  | { readonly ok: false; readonly diagnostics: readonly PipelineDiagnostic[] };

type CallEdge = {
  readonly from: string;
  readonly to: string;
  readonly path: JsonPointer;
};

const outcomeKeysMatch = (
  callOutcomes: readonly { readonly outcome: string }[],
  moduleOutcomes: readonly { readonly outcome: string }[],
): boolean =>
  JSON.stringify(callOutcomes.map(({ outcome }) => outcome)) ===
  JSON.stringify(moduleOutcomes.map(({ outcome }) => outcome));

const findRecursion = (edges: readonly CallEdge[]): readonly JsonPointer[] => {
  const byModule = Map.groupBy(edges, ({ from }) => from);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const recursivePaths: JsonPointer[] = [];

  const visit = (moduleKey: string): void => {
    if (visited.has(moduleKey)) {
      return;
    }
    visiting.add(moduleKey);
    for (const edge of byModule.get(moduleKey) ?? []) {
      if (visiting.has(edge.to)) {
        recursivePaths.push(edge.path);
      } else {
        visit(edge.to);
      }
    }
    visiting.delete(moduleKey);
    visited.add(moduleKey);
  };

  for (const moduleKey of byModule.keys()) {
    visit(moduleKey);
  }
  return Object.freeze(recursivePaths);
};

const findDepthViolations = (edges: readonly CallEdge[]): readonly JsonPointer[] => {
  const byModule = Map.groupBy(edges, ({ from }) => from);
  const violations: JsonPointer[] = [];
  const deepestVisit = new Map<string, number>();
  const pending = [...byModule.keys()].map((moduleKey) => ({ moduleKey, depth: 0 }));
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || current.depth <= (deepestVisit.get(current.moduleKey) ?? -1)) {
      continue;
    }
    deepestVisit.set(current.moduleKey, current.depth);
    for (const edge of byModule.get(current.moduleKey) ?? []) {
      const depth = current.depth + 1;
      if (depth > PIPELINE_LIMITS.sourcePackage.callDepth) {
        violations.push(edge.path);
      } else {
        pending.push({ moduleKey: edge.to, depth });
      }
    }
  }
  return Object.freeze(violations);
};

export const linkSource = (source: PipelineSourcePackage): LinkResult => {
  const diagnostics = createDiagnosticCollector();
  const layout = indexSourceLayout(source);
  const modulesByKey = new Map(source.modules.map((module) => [module.key, module]));
  const callsByPath = new Map<JsonPointer, LinkedCall>();
  const edges: CallEdge[] = [];

  for (const location of layout.nodes) {
    if (location.node.kind !== 'call') {
      continue;
    }
    const target = modulesByKey.get(location.node.module);
    if (target === undefined) {
      diagnostics.add('LINK_MODULE_MISSING', appendJsonPointer(location.path, 'module'));
      continue;
    }
    if (!outcomeKeysMatch(location.node.routes.outcomes, target.region.exits)) {
      diagnostics.add('LINK_MODULE_OUTCOME_MISMATCH', `${location.path}/routes/outcomes`);
    }
    callsByPath.set(location.path, Object.freeze({ target }));
    edges.push(
      Object.freeze({
        from: location.module.key,
        to: target.key,
        path: appendJsonPointer(location.path, 'module'),
      }),
    );
  }

  const recursion = findRecursion(edges);
  for (const path of recursion) {
    diagnostics.add('LINK_RECURSION', path);
  }
  if (recursion.length === 0) {
    for (const path of findDepthViolations(edges)) {
      diagnostics.add('BOUND_EXCEEDED', path);
    }
  }

  const finalized = diagnostics.finalize();
  return finalized.length > 0
    ? { ok: false, diagnostics: finalized }
    : {
        ok: true,
        value: Object.freeze({ modulesByKey, callsByPath }),
      };
};
