import type { JsonPointer } from '../../foundation/index.js';
import type {
  ProgramActivityNode,
  ProgramCallNode,
  ProgramChoiceNode,
  ProgramEndNode,
  ProgramHumanGateNode,
  ProgramWaitNode,
} from '../../program/index.js';
import {
  type AgentSourceNode,
  type CallSourceNode,
  type ChoiceSourceNode,
  type EndSourceNode,
  type HumanGateSourceNode,
  type ScriptSourceNode,
  type WaitSourceNode,
} from '../../source/index.js';
import type { LoweredNodeFragment, LoweringContext, RequirementUse } from './contracts.js';
import { createLoweredIdentity } from './identity.js';
import { nonEmpty } from './non-empty.js';
import { activityTargetRoutes, targetId, waitTargetRoutes } from './routes.js';
import { lowerMapping, lowerSelector } from './selectors.js';

type DirectNode =
  | ScriptSourceNode
  | ChoiceSourceNode
  | CallSourceNode
  | WaitSourceNode
  | HumanGateSourceNode
  | EndSourceNode;

const fragment = (
  node: LoweredNodeFragment['nodes'][number],
  provenance: LoweredNodeFragment['provenance'][number],
  requirements: readonly RequirementUse[] = [],
): LoweredNodeFragment =>
  Object.freeze({
    nodes: Object.freeze([node]),
    provenance: Object.freeze([provenance]),
    requirements: Object.freeze(requirements),
  });

export const lowerSingleAgent = (
  node: AgentSourceNode,
  path: JsonPointer,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
  context: LoweringContext,
): LoweredNodeFragment => {
  const selected = context.agentSelections.get(path);
  if (selected?.slot.selection.strategy !== 'single') {
    throw new TypeError('Expected a validated single-agent materialization.');
  }
  const strategy = node.strategies.find(({ kind }) => kind === 'single');
  if (strategy?.kind !== 'single') {
    throw new TypeError('Expected a validated single strategy.');
  }
  const materializationPath = `/${selected.slot.sourceNodeId}/participant` as JsonPointer;
  const identity = createLoweredIdentity(path, 'agentSingleActivity', 0, materializationPath);
  const requirement = Object.freeze({
    kind: 'agent' as const,
    key: selected.slot.selection.participant.bindingKey,
    bindingKey: selected.slot.selection.participant.bindingKey,
    inputSchema: node.inputSchema,
    outputSchema: node.outputSchema,
  } as const);
  const activity: ProgramActivityNode = Object.freeze({
    kind: 'activity',
    id: identity.id,
    activityKind: 'agent',
    requirementKey: requirement.key,
    input: lowerMapping(node.input, targetIds),
    inputSchema: node.inputSchema,
    outputSchema: node.outputSchema,
    routes: activityTargetRoutes(strategy.routes, targetIds),
  });
  return fragment(activity, identity.provenance, [
    Object.freeze({ requirement, sourcePath: path, materializationPath }),
  ]);
};

const lowerActivity = (
  node: ScriptSourceNode,
  path: JsonPointer,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
): LoweredNodeFragment => {
  const identity = createLoweredIdentity(path, 'direct', 0, null);
  const requirement = Object.freeze({
    kind: 'script' as const,
    key: node.requirementKey,
    script: node.script,
    inputSchema: node.inputSchema,
    outputSchema: node.outputSchema,
  });
  const activity: ProgramActivityNode = Object.freeze({
    kind: 'activity',
    id: identity.id,
    activityKind: node.kind,
    requirementKey: requirement.key,
    input: lowerMapping(node.input, targetIds),
    inputSchema: node.inputSchema,
    outputSchema: node.outputSchema,
    routes: activityTargetRoutes(node.routes, targetIds),
  });
  return fragment(activity, identity.provenance, [
    Object.freeze({ requirement, sourcePath: path, materializationPath: null }),
  ]);
};

const lowerChoice = (
  node: ChoiceSourceNode,
  id: `sha256:${string}`,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
): ProgramChoiceNode => {
  const cases = node.cases.map(({ key, when, target }) =>
    Object.freeze({ key, when, target: targetId(target, targetIds) }),
  );
  return Object.freeze({
    kind: 'choice',
    id,
    selector: lowerSelector(node.selector, targetIds),
    cases: nonEmpty(cases, 'Expected validated choice cases.'),
    otherwise: node.otherwise === null ? null : targetId(node.otherwise, targetIds),
  });
};

const lowerCall = (
  node: CallSourceNode,
  id: `sha256:${string}`,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
): ProgramCallNode => {
  const outcomes = node.routes.outcomes.map(({ outcome, target }) =>
    Object.freeze({ outcome, target: targetId(target, targetIds) }),
  );
  return Object.freeze({
    kind: 'call',
    id,
    module: node.module,
    input: lowerMapping(node.input, targetIds),
    outputSchema: node.outputSchema,
    routes: Object.freeze({
      outcomes: nonEmpty(outcomes, 'Expected validated call outcomes.'),
      failed: targetId(node.routes.failed, targetIds),
      cancelled: targetId(node.routes.cancelled, targetIds),
    }),
  });
};

const lowerDirectNode = (
  node: DirectNode,
  id: `sha256:${string}`,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
): LoweredNodeFragment['nodes'][number] => {
  switch (node.kind) {
    case 'script':
      throw new TypeError('Activities are lowered with their requirements.');
    case 'choice':
      return lowerChoice(node, id, targetIds);
    case 'call':
      return lowerCall(node, id, targetIds);
    case 'wait':
      return Object.freeze({
        kind: 'wait',
        id,
        wait: node.wait,
        routes: waitTargetRoutes(node.routes, targetIds),
      }) satisfies ProgramWaitNode;
    case 'humanGate':
      return Object.freeze({
        kind: 'humanGate',
        id,
        subject: node.subject,
        answers: node.answers,
        authorizationRequirements: node.authorizationRequirements,
        payloadSchema: node.payloadSchema,
        deadline:
          node.deadline === null
            ? null
            : Object.freeze({
                afterMs: node.deadline.afterMs,
                target: targetId(node.deadline.target, targetIds),
              }),
        routes: Object.freeze({
          answers: nonEmpty(
            node.routes.answers.map(({ answer, target }) =>
              Object.freeze({ answer, target: targetId(target, targetIds) }),
            ),
            'Expected validated human-gate answers.',
          ),
          cancelled: targetId(node.routes.cancelled, targetIds),
        }),
      }) satisfies ProgramHumanGateNode;
    case 'end':
      return Object.freeze({
        kind: 'end',
        id,
        outcome: node.outcome,
        output: lowerMapping(node.output, targetIds),
      }) satisfies ProgramEndNode;
  }
  throw new TypeError('Unexpected schema-validated direct source node.');
};

export const lowerDirect = (
  node: DirectNode,
  path: JsonPointer,
  targetIds: ReadonlyMap<string, `sha256:${string}`>,
): LoweredNodeFragment => {
  if (node.kind === 'script') {
    return lowerActivity(node, path, targetIds);
  }
  const identity = createLoweredIdentity(path, 'direct', 0, null);
  return fragment(lowerDirectNode(node, identity.id, targetIds), identity.provenance);
};
