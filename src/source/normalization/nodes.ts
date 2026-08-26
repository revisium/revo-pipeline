import {
  appendJsonPointer,
  compareUnicodeCodePoints,
  isDisplayString,
  type JsonPointer,
} from '../../foundation/index.js';
import type {
  AgentSourceNode,
  CallSourceNode,
  ChoiceSourceNode,
  ConsensusSourceNode,
  EndSourceNode,
  HumanGateSourceNode,
  MapSourceNode,
  ParallelSourceNode,
  RepeatSourceNode,
  ScriptSourceNode,
  SourceNode,
  SourceRegion,
  WaitSourceNode,
} from '../contracts/index.js';
import { atLeastTwoTuple, nestedPath, nonEmptyTuple, validateIdentifier } from '../internal.js';
import { normalizeChoiceDomain, normalizeValueSchema } from '../value-schema/index.js';
import {
  normalizeAgentStrategy,
  normalizeKeyed,
  normalizeMapping,
  normalizePolicy,
  normalizeRepeatCondition,
  normalizeSelector,
  validatePointer,
  type NormalizationContext,
} from './common.js';

export type RegionNormalizer = (
  region: SourceRegion,
  path: JsonPointer,
  context: NormalizationContext,
  regionDepth: number,
) => SourceRegion;

const normalizeAgent = (
  node: AgentSourceNode,
  path: JsonPointer,
  context: NormalizationContext,
): AgentSourceNode => {
  const strategiesPath = appendJsonPointer(path, 'strategies');
  const strategies = nonEmptyTuple(
    normalizeKeyed(node.strategies, ({ kind }) => kind, strategiesPath, context.collector).map(
      (strategy, index) =>
        normalizeAgentStrategy(
          strategy,
          appendJsonPointer(strategiesPath, String(index)),
          context.collector,
        ),
    ),
  );
  return Object.freeze({
    ...node,
    strategies: Object.freeze(strategies),
    input: normalizeMapping(node.input, appendJsonPointer(path, 'input'), context),
    inputSchema: normalizeValueSchema(
      node.inputSchema,
      appendJsonPointer(path, 'inputSchema'),
      context.collector,
    ),
    outputSchema: normalizeValueSchema(
      node.outputSchema,
      appendJsonPointer(path, 'outputSchema'),
      context.collector,
    ),
  });
};

const normalizeScript = (
  node: ScriptSourceNode,
  path: JsonPointer,
  context: NormalizationContext,
): ScriptSourceNode => {
  validateIdentifier(
    node.requirementKey,
    appendJsonPointer(path, 'requirementKey'),
    context.collector,
  );
  return Object.freeze({
    ...node,
    script: Object.freeze({ ...node.script }),
    input: normalizeMapping(node.input, appendJsonPointer(path, 'input'), context),
    inputSchema: normalizeValueSchema(
      node.inputSchema,
      appendJsonPointer(path, 'inputSchema'),
      context.collector,
    ),
    outputSchema: normalizeValueSchema(
      node.outputSchema,
      appendJsonPointer(path, 'outputSchema'),
      context.collector,
    ),
    routes: Object.freeze({ ...node.routes }),
  });
};

const normalizeChoice = (
  node: ChoiceSourceNode,
  path: JsonPointer,
  context: NormalizationContext,
): ChoiceSourceNode => {
  const casesPath = appendJsonPointer(path, 'cases');
  const cases = nonEmptyTuple(
    normalizeKeyed(node.cases, ({ key }) => key, casesPath, context.collector).map(
      (choiceCase, index) => {
        const casePath = appendJsonPointer(casesPath, String(index));
        validateIdentifier(choiceCase.key, appendJsonPointer(casePath, 'key'), context.collector);
        return Object.freeze({
          ...choiceCase,
          when: normalizeChoiceDomain(
            choiceCase.when,
            appendJsonPointer(casePath, 'when'),
            context.collector,
          ),
        });
      },
    ),
  );
  return Object.freeze({
    ...node,
    selector: normalizeSelector(node.selector, appendJsonPointer(path, 'selector'), context),
    cases: Object.freeze(cases),
  });
};

const normalizeParallel = (
  node: ParallelSourceNode,
  path: JsonPointer,
  context: NormalizationContext,
  regionDepth: number,
  normalizeRegion: RegionNormalizer,
): ParallelSourceNode => {
  const branchesPath = appendJsonPointer(path, 'branches');
  const branches = atLeastTwoTuple(
    normalizeKeyed(node.branches, ({ key }) => key, branchesPath, context.collector).map(
      (branch, index) => {
        const branchPath = appendJsonPointer(branchesPath, String(index));
        validateIdentifier(branch.key, appendJsonPointer(branchPath, 'key'), context.collector);
        const exitsPath = appendJsonPointer(branchPath, 'exits');
        return Object.freeze({
          ...branch,
          input: normalizeMapping(branch.input, appendJsonPointer(branchPath, 'input'), context),
          region: normalizeRegion(
            branch.region,
            appendJsonPointer(branchPath, 'region'),
            context,
            regionDepth + 1,
          ),
          exits: nonEmptyTuple(
            normalizeKeyed(
              branch.exits,
              ({ outcome }) => outcome,
              exitsPath,
              context.collector,
            ).map((exit, exitIndex) => {
              validateIdentifier(
                exit.outcome,
                nestedPath(exitsPath, String(exitIndex), 'outcome'),
                context.collector,
              );
              return Object.freeze({ ...exit });
            }),
          ),
        });
      },
    ),
  );
  if (node.policy.kind === 'threshold' && node.policy.count > branches.length) {
    context.collector.add('BOUND_EXCEEDED', nestedPath(path, 'policy', 'count'));
  }
  return Object.freeze({
    ...node,
    branches: Object.freeze(branches),
    policy: Object.freeze({ ...node.policy }),
    routes: Object.freeze({ ...node.routes }),
  });
};

const normalizeRepeat = (
  node: RepeatSourceNode,
  path: JsonPointer,
  context: NormalizationContext,
  regionDepth: number,
  normalizeRegion: RegionNormalizer,
): RepeatSourceNode => {
  const exitsPath = appendJsonPointer(path, 'bodyExits');
  return Object.freeze({
    ...node,
    initialInput: normalizeMapping(
      node.initialInput,
      appendJsonPointer(path, 'initialInput'),
      context,
    ),
    nextInput: normalizeMapping(node.nextInput, appendJsonPointer(path, 'nextInput'), context),
    body: normalizeRegion(node.body, appendJsonPointer(path, 'body'), context, regionDepth + 1),
    bodyExits: nonEmptyTuple(
      normalizeKeyed(node.bodyExits, ({ outcome }) => outcome, exitsPath, context.collector).map(
        (exit, index) => {
          validateIdentifier(
            exit.outcome,
            nestedPath(exitsPath, String(index), 'outcome'),
            context.collector,
          );
          return Object.freeze({ ...exit });
        },
      ),
    ),
    continueWhen: normalizeRepeatCondition(
      node.continueWhen,
      appendJsonPointer(path, 'continueWhen'),
      context,
      0,
    ),
    output: normalizeMapping(node.output, appendJsonPointer(path, 'output'), context),
    outputSchema: normalizeValueSchema(
      node.outputSchema,
      appendJsonPointer(path, 'outputSchema'),
      context.collector,
    ),
    routes: Object.freeze({ ...node.routes }),
  });
};

const normalizeMap = (
  node: MapSourceNode,
  path: JsonPointer,
  context: NormalizationContext,
  regionDepth: number,
  normalizeRegion: RegionNormalizer,
): MapSourceNode => {
  validatePointer(
    node.itemKeyPointer,
    appendJsonPointer(path, 'itemKeyPointer'),
    context.collector,
  );
  if (node.maximumConcurrency > Math.max(1, node.maximumItems)) {
    context.collector.add('BOUND_EXCEEDED', appendJsonPointer(path, 'maximumConcurrency'));
  }
  const exitsPath = appendJsonPointer(path, 'bodyExits');
  return Object.freeze({
    ...node,
    items: normalizeSelector(node.items, appendJsonPointer(path, 'items'), context),
    bodyInput: normalizeMapping(node.bodyInput, appendJsonPointer(path, 'bodyInput'), context),
    body: normalizeRegion(node.body, appendJsonPointer(path, 'body'), context, regionDepth + 1),
    bodyExits: nonEmptyTuple(
      normalizeKeyed(node.bodyExits, ({ outcome }) => outcome, exitsPath, context.collector).map(
        (exit, index) => {
          validateIdentifier(
            exit.outcome,
            nestedPath(exitsPath, String(index), 'outcome'),
            context.collector,
          );
          return Object.freeze({ ...exit });
        },
      ),
    ),
    failure: Object.freeze({ ...node.failure }),
    routes: Object.freeze({ ...node.routes }),
  });
};

const normalizeWait = (
  node: WaitSourceNode,
  path: JsonPointer,
  context: NormalizationContext,
): WaitSourceNode => {
  if (node.wait.kind === 'signal') {
    validateIdentifier(node.wait.signal, nestedPath(path, 'wait', 'signal'), context.collector);
  }
  return Object.freeze({
    ...node,
    wait:
      node.wait.kind === 'duration' || node.wait.payloadSchema === null
        ? Object.freeze({ ...node.wait })
        : Object.freeze({
            ...node.wait,
            payloadSchema: normalizeValueSchema(
              node.wait.payloadSchema,
              nestedPath(path, 'wait', 'payloadSchema'),
              context.collector,
            ),
          }),
    routes: Object.freeze({ ...node.routes }),
  });
};

const normalizeHumanGate = (
  node: HumanGateSourceNode,
  path: JsonPointer,
  context: NormalizationContext,
): HumanGateSourceNode => {
  if (!isDisplayString(node.subject)) {
    context.collector.add('BOUND_EXCEEDED', appendJsonPointer(path, 'subject'));
  }
  for (const [index, requirement] of node.authorizationRequirements.entries()) {
    validateIdentifier(
      requirement,
      nestedPath(path, 'authorizationRequirements', String(index)),
      context.collector,
    );
  }
  const answers = [...node.answers].sort(compareUnicodeCodePoints);
  for (const [index, answer] of answers.entries()) {
    validateIdentifier(answer, nestedPath(path, 'answers', String(index)), context.collector);
  }
  const routeAnswers = nonEmptyTuple(
    [...node.routes.answers]
      .sort((left, right) => compareUnicodeCodePoints(left.answer, right.answer))
      .map((route, index) => {
        validateIdentifier(
          route.answer,
          nestedPath(path, 'routes', 'answers', String(index), 'answer'),
          context.collector,
        );
        return Object.freeze({ ...route });
      }),
  );
  return Object.freeze({
    ...node,
    payloadSchema:
      node.payloadSchema === null
        ? null
        : normalizeValueSchema(
            node.payloadSchema,
            appendJsonPointer(path, 'payloadSchema'),
            context.collector,
          ),
    answers: nonEmptyTuple(answers),
    authorizationRequirements: Object.freeze([...node.authorizationRequirements]),
    routes: Object.freeze({ ...node.routes, answers: Object.freeze(routeAnswers) }),
  });
};

const normalizeConsensus = (
  node: ConsensusSourceNode,
  path: JsonPointer,
  context: NormalizationContext,
): ConsensusSourceNode => {
  const participantsPath = appendJsonPointer(path, 'participants');
  const participants = atLeastTwoTuple(
    normalizeKeyed(node.participants, ({ key }) => key, participantsPath, context.collector).map(
      (participant, index) => {
        const participantPath = appendJsonPointer(participantsPath, String(index));
        validateIdentifier(
          participant.key,
          appendJsonPointer(participantPath, 'key'),
          context.collector,
        );
        validateIdentifier(
          participant.bindingKey,
          appendJsonPointer(participantPath, 'bindingKey'),
          context.collector,
        );
        return Object.freeze({
          ...participant,
          input: normalizeMapping(
            participant.input,
            appendJsonPointer(participantPath, 'input'),
            context,
          ),
          inputSchema: normalizeValueSchema(
            participant.inputSchema,
            appendJsonPointer(participantPath, 'inputSchema'),
            context.collector,
          ),
        });
      },
    ),
  );
  return Object.freeze({
    ...node,
    participants: Object.freeze(participants),
    policy: normalizePolicy(
      node.policy,
      appendJsonPointer(path, 'policy'),
      participants.length,
      participants.length,
      context.collector,
    ),
    routes: Object.freeze({ ...node.routes }),
  });
};

const normalizeCall = (
  node: CallSourceNode,
  path: JsonPointer,
  context: NormalizationContext,
): CallSourceNode => {
  validateIdentifier(node.module, appendJsonPointer(path, 'module'), context.collector);
  const outcomesPath = nestedPath(path, 'routes', 'outcomes');
  const outcomes = nonEmptyTuple(
    normalizeKeyed(
      node.routes.outcomes,
      ({ outcome }) => outcome,
      outcomesPath,
      context.collector,
    ).map((outcome, index) => {
      validateIdentifier(
        outcome.outcome,
        nestedPath(outcomesPath, String(index), 'outcome'),
        context.collector,
      );
      return Object.freeze({ ...outcome });
    }),
  );
  return Object.freeze({
    ...node,
    input: normalizeMapping(node.input, appendJsonPointer(path, 'input'), context),
    outputSchema: normalizeValueSchema(
      node.outputSchema,
      appendJsonPointer(path, 'outputSchema'),
      context.collector,
    ),
    routes: Object.freeze({ ...node.routes, outcomes: Object.freeze(outcomes) }),
  });
};

const normalizeEnd = (
  node: EndSourceNode,
  path: JsonPointer,
  context: NormalizationContext,
): EndSourceNode => {
  validateIdentifier(node.outcome, appendJsonPointer(path, 'outcome'), context.collector);
  return Object.freeze({
    ...node,
    output: normalizeMapping(node.output, appendJsonPointer(path, 'output'), context),
  });
};

export const normalizeSourceNode = (
  node: SourceNode,
  path: JsonPointer,
  context: NormalizationContext,
  regionDepth: number,
  normalizeRegion: RegionNormalizer,
): SourceNode => {
  validateIdentifier(node.id, appendJsonPointer(path, 'id'), context.collector);
  switch (node.kind) {
    case 'agent':
      return normalizeAgent(node, path, context);
    case 'script':
      return normalizeScript(node, path, context);
    case 'choice':
      return normalizeChoice(node, path, context);
    case 'parallel':
      return normalizeParallel(node, path, context, regionDepth, normalizeRegion);
    case 'repeat':
      return normalizeRepeat(node, path, context, regionDepth, normalizeRegion);
    case 'map':
      return normalizeMap(node, path, context, regionDepth, normalizeRegion);
    case 'wait':
      return normalizeWait(node, path, context);
    case 'humanGate':
      return normalizeHumanGate(node, path, context);
    case 'consensus':
      return normalizeConsensus(node, path, context);
    case 'call':
      return normalizeCall(node, path, context);
    case 'end':
      return normalizeEnd(node, path, context);
  }
  throw new TypeError('Unexpected schema-validated source node.');
};
