import {
  PIPELINE_LIMITS,
  appendJsonPointer,
  compareUnicodeCodePoints,
  isJsonPointer,
  type DiagnosticCollector,
  type JsonPointer,
  type PortableNormalizationSession,
} from '../../foundation/index.js';
import type {
  AgentSlotStrategy,
  ConsensusPolicy,
  RepeatCondition,
  ValueMapping,
  ValueSelector,
} from '../contracts/index.js';
import { atLeastTwoTuple, validateIdentifier } from '../internal.js';

export type NormalizationContext = {
  readonly collector: DiagnosticCollector;
  readonly portable: PortableNormalizationSession;
};

export const validatePointer = (
  value: JsonPointer,
  path: JsonPointer,
  collector: DiagnosticCollector,
): void => {
  if (!isJsonPointer(value)) {
    collector.add('CANONICAL_INPUT', path);
  }
};

export const normalizeKeyed = <Value>(
  values: readonly Value[],
  keyOf: (value: Value) => string,
  path: JsonPointer,
  collector: DiagnosticCollector,
): readonly Value[] => {
  const seen = new Set<string>();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) {
      collector.add('CANONICAL_INPUT', path);
    }
    seen.add(key);
  }
  return Object.freeze(
    [...values].sort((left, right) => compareUnicodeCodePoints(keyOf(left), keyOf(right))),
  );
};

export const normalizeSelector = (
  selector: ValueSelector,
  path: JsonPointer,
  context: NormalizationContext,
): ValueSelector => {
  if (selector.kind === 'literal') {
    const valuePath = appendJsonPointer(path, 'value');
    const result = context.portable.normalize(selector.value, valuePath);
    if (!result.ok) {
      context.collector.add('CANONICAL_INPUT', result.failure.path);
      return selector;
    }
    return Object.freeze({ kind: 'literal', value: result.value });
  }
  validatePointer(selector.pointer, appendJsonPointer(path, 'pointer'), context.collector);
  if (selector.kind === 'nodeOutput' || selector.kind === 'nodeFailure') {
    validateIdentifier(selector.node, appendJsonPointer(path, 'node'), context.collector);
  }
  return Object.freeze({ ...selector });
};

export const normalizeMapping = (
  mapping: ValueMapping,
  path: JsonPointer,
  context: NormalizationContext,
): ValueMapping => {
  const normalized: Record<string, ValueSelector> = {};
  for (const [key, selector] of Object.entries(mapping)) {
    normalized[key] = normalizeSelector(selector, appendJsonPointer(path, key), context);
  }
  return Object.freeze(normalized);
};

export const normalizeRepeatCondition = (
  condition: RepeatCondition,
  path: JsonPointer,
  context: NormalizationContext,
  depth: number,
): RepeatCondition => {
  if (depth > PIPELINE_LIMITS.sourcePackage.nestingDepth) {
    context.collector.add('BOUND_EXCEEDED', path);
  }
  if (condition.kind === 'all' || condition.kind === 'any') {
    return Object.freeze({
      kind: condition.kind,
      conditions: atLeastTwoTuple(
        condition.conditions.map((nested, index) =>
          normalizeRepeatCondition(
            nested,
            appendJsonPointer(appendJsonPointer(path, 'conditions'), String(index)),
            context,
            depth + 1,
          ),
        ),
      ),
    });
  }
  if (condition.kind === 'not') {
    return Object.freeze({
      kind: 'not',
      condition: normalizeRepeatCondition(
        condition.condition,
        appendJsonPointer(path, 'condition'),
        context,
        depth + 1,
      ),
    });
  }
  const selector = normalizeSelector(
    condition.selector,
    appendJsonPointer(path, 'selector'),
    context,
  );
  return condition.kind === 'exists'
    ? Object.freeze({ kind: 'exists', selector })
    : Object.freeze({ ...condition, selector });
};

export const normalizePolicy = (
  policy: ConsensusPolicy,
  path: JsonPointer,
  participantMinimum: number,
  participantMaximum: number,
  collector: DiagnosticCollector,
): ConsensusPolicy => {
  if (policy.kind === 'quorum' && policy.minimumParticipation > participantMinimum) {
    collector.add('BOUND_EXCEEDED', appendJsonPointer(path, 'minimumParticipation'));
  }
  if (
    policy.kind === 'independentThreshold' &&
    (policy.approveThreshold > participantMinimum ||
      policy.rejectThreshold > participantMinimum ||
      policy.approveThreshold + policy.rejectThreshold <= participantMaximum)
  ) {
    collector.add('BOUND_EXCEEDED', path);
  }
  return Object.freeze({ ...policy });
};

export const normalizeAgentStrategy = (
  strategy: AgentSlotStrategy,
  path: JsonPointer,
  collector: DiagnosticCollector,
): AgentSlotStrategy => {
  if (strategy.kind === 'single') {
    return Object.freeze({ kind: 'single', routes: Object.freeze({ ...strategy.routes }) });
  }
  if (strategy.minimumParticipants > strategy.maximumParticipants) {
    collector.add('BOUND_EXCEEDED', path);
  }
  return Object.freeze({
    ...strategy,
    policy: normalizePolicy(
      strategy.policy,
      appendJsonPointer(path, 'policy'),
      strategy.minimumParticipants,
      strategy.maximumParticipants,
      collector,
    ),
    routes: Object.freeze({ ...strategy.routes }),
  });
};
