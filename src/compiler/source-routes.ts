import type { AgentSlotStrategy, SourceNode } from '../source/index.js';

export type SourceRouteStatus = 'succeeded' | 'failed' | 'cancelled' | 'neutral';
export type SourceRoute = { readonly target: string; readonly status: SourceRouteStatus };

const entries = (
  routes: Readonly<Record<string, string>>,
  statusOf: (route: string) => SourceRouteStatus,
): readonly SourceRoute[] =>
  Object.entries(routes).map(([route, target]) => ({ target, status: statusOf(route) }));

const activityStatus = (route: string): SourceRouteStatus => {
  if (route === 'succeeded' || route === 'failed' || route === 'cancelled') {
    return route;
  }
  throw new TypeError('Unexpected schema-validated activity route.');
};

const completionStatus = (route: string): SourceRouteStatus => {
  if (route === 'failed' || route === 'cancelled') {
    return route;
  }
  return 'succeeded';
};

const agentRoutes = (strategy: AgentSlotStrategy): readonly SourceRoute[] =>
  strategy.kind === 'single'
    ? entries(strategy.routes, activityStatus)
    : entries(strategy.routes, () => 'succeeded');

export const sourceRoutes = (
  node: SourceNode,
  selectedAgentStrategy?: AgentSlotStrategy,
): readonly SourceRoute[] => {
  if (node.kind === 'agent') {
    return selectedAgentStrategy === undefined ? [] : agentRoutes(selectedAgentStrategy);
  }
  if (node.kind === 'script' || node.kind === 'effect') {
    return entries(node.routes, activityStatus);
  }
  if (node.kind === 'choice') {
    return [
      ...node.cases.map(({ target }) => ({ target, status: 'neutral' as const })),
      ...(node.otherwise === null ? [] : [{ target: node.otherwise, status: 'neutral' as const }]),
    ];
  }
  if (node.kind === 'call') {
    return [
      ...node.routes.outcomes.map(({ target }) => ({ target, status: 'succeeded' as const })),
      { target: node.routes.failed, status: 'failed' },
      { target: node.routes.cancelled, status: 'cancelled' },
    ];
  }
  if (node.kind === 'repeat') {
    return entries(node.routes, completionStatus);
  }
  if (node.kind === 'map' || node.kind === 'wait') {
    return entries(node.routes, completionStatus);
  }
  if (node.kind === 'humanGate') {
    return [
      ...node.routes.answers.map(({ target }) => ({ target, status: 'succeeded' as const })),
      { target: node.routes.conflict, status: 'succeeded' },
      { target: node.routes.deadline, status: 'succeeded' },
      { target: node.routes.cancelled, status: 'cancelled' },
    ];
  }
  if (node.kind === 'parallel' || node.kind === 'consensus') {
    return entries(node.routes, () => 'succeeded');
  }
  return [];
};
