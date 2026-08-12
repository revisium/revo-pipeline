import type {
  ProgramNodeId,
  ProgramRepeatCondition,
  ProgramValueMapping,
  ProgramValueSelector,
} from '../../program/index.js';
import type { RepeatCondition, ValueMapping, ValueSelector } from '../../source/index.js';

export const lowerSelector = (
  selector: ValueSelector,
  nodeIds: ReadonlyMap<string, ProgramNodeId>,
): ProgramValueSelector => {
  if (selector.kind === 'nodeOutput' || selector.kind === 'nodeFailure') {
    const nodeId = nodeIds.get(selector.node);
    if (nodeId === undefined) {
      throw new TypeError('Expected a validated local node reference.');
    }
    return Object.freeze({ kind: selector.kind, nodeId, pointer: selector.pointer });
  }
  return Object.freeze({ ...selector });
};

export const lowerMapping = (
  mapping: ValueMapping,
  nodeIds: ReadonlyMap<string, ProgramNodeId>,
): ProgramValueMapping =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(mapping).map(([key, selector]) => [key, lowerSelector(selector, nodeIds)]),
    ),
  );

export const lowerRepeatCondition = (
  condition: RepeatCondition,
  nodeIds: ReadonlyMap<string, ProgramNodeId>,
): ProgramRepeatCondition => {
  if (condition.kind === 'all' || condition.kind === 'any') {
    const conditions = condition.conditions.map((nested) => lowerRepeatCondition(nested, nodeIds));
    const [first, second, ...rest] = conditions;
    if (first === undefined || second === undefined) {
      throw new TypeError('Expected a validated compound repeat condition.');
    }
    const compound: readonly [
      ProgramRepeatCondition,
      ProgramRepeatCondition,
      ...ProgramRepeatCondition[],
    ] = Object.freeze([first, second, ...rest]);
    return condition.kind === 'all'
      ? Object.freeze({ kind: 'all', conditions: compound })
      : Object.freeze({ kind: 'any', conditions: compound });
  }
  if (condition.kind === 'not') {
    return Object.freeze({
      kind: 'not',
      condition: lowerRepeatCondition(condition.condition, nodeIds),
    });
  }
  const selector = lowerSelector(condition.selector, nodeIds);
  return condition.kind === 'exists'
    ? Object.freeze({ kind: 'exists', selector })
    : Object.freeze({ ...condition, selector });
};
