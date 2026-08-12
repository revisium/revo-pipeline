import { PIPELINE_LIMITS } from '../../foundation/index.js';
import type { ProgramModule } from '../../program/index.js';

export type ModuleCallEdge = { readonly from: string; readonly to: string };

export const hasValidCallGraph = (
  modules: ReadonlyMap<string, ProgramModule>,
  edges: readonly ModuleCallEdge[],
): boolean => {
  const outgoing = new Map<string, string[]>([...modules.keys()].map((key) => [key, []]));
  const indegree = new Map<string, number>([...modules.keys()].map((key) => [key, 0]));
  for (const { from, to } of edges) {
    outgoing.get(from)?.push(to);
    indegree.set(to, (indegree.get(to) ?? 0) + 1);
  }
  const depths = new Map<string, number>([...modules.keys()].map((key) => [key, 0]));
  const pending = [...indegree].filter(([, degree]) => degree === 0).map(([key]) => key);
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    visited += 1;
    for (const target of outgoing.get(current) ?? []) {
      const depth = (depths.get(current) ?? 0) + 1;
      if (depth > PIPELINE_LIMITS.sourcePackage.callDepth) {
        return false;
      }
      depths.set(target, Math.max(depths.get(target) ?? 0, depth));
      const degree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, degree);
      if (degree === 0) {
        pending.push(target);
      }
    }
  }
  return visited === modules.size;
};
