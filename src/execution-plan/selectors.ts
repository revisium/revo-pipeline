import { compareUnicodeCodePoints, isIdentifier } from '../foundation/index.js';
import type { ProgramValueMapping, ProgramValueSelector } from '../program/index.js';
import type { PipelineExecutionValueSource } from './contracts.js';

const lowerSelector = (selector: ProgramValueSelector): PipelineExecutionValueSource | null => {
  if (selector.kind === 'literal') {
    return Object.freeze({ kind: 'literal', value: selector.value });
  }
  if (selector.kind === 'moduleInput') {
    return Object.freeze({ kind: 'pipelineInput', pointer: selector.pointer });
  }
  return null;
};

export const lowerExecutionSelector = (
  selector: ProgramValueSelector,
): PipelineExecutionValueSource | null => lowerSelector(selector);

export const lowerExecutionOutput = (
  output: ProgramValueMapping,
): Readonly<Record<string, PipelineExecutionValueSource>> | null => {
  const entries: [string, PipelineExecutionValueSource][] = [];
  for (const [key, selector] of Object.entries(output).toSorted(([left], [right]) =>
    compareUnicodeCodePoints(left, right),
  )) {
    const lowered = lowerSelector(selector);
    if (!isIdentifier(key) || lowered === null) {
      return null;
    }
    entries.push([key, lowered]);
  }
  return Object.freeze(Object.fromEntries(entries));
};
