import { describe, expect, test } from 'vitest';

import {
  ADVISORY_CALLABLE_LINES,
  sourceMetricScope,
  validateSourceMetrics,
  type MetricSource,
  type SourceMetricRule,
} from '../../../scripts/architecture/validate-source-metrics.js';

const path = 'src/definition/example.ts';
const sourceWithLines = (lines: readonly string[]): MetricSource => ({
  path,
  source: `${lines.join('\n')}\n`,
});
const expectViolation = (source: MetricSource, rule: SourceMetricRule): void => {
  expect(() => validateSourceMetrics([source], [path])).toThrowError(`[${rule}]`);
};
const callable = (opening: string, closing: string, lines: number): MetricSource =>
  sourceWithLines([opening, ...Array.from({ length: lines - 2 }, () => '  void 0;'), closing]);
const bodyless = (opening: string, closing: string): MetricSource =>
  sourceWithLines([opening, ...Array.from({ length: 79 }, () => '  // signature'), closing]);

test('rejects duplicate and unknown production scope paths before filtering', () => {
  const source = sourceWithLines(['void 0;']);
  expect(() => validateSourceMetrics([source], [path, path])).toThrowError(
    '[production-metric-scope] duplicate production path',
  );
  expect(() => validateSourceMetrics([source], ['src/definition/missing.ts'])).toThrowError(
    '[production-metric-scope] unknown production path: src/definition/missing.ts',
  );
});

test('derives the complete PR4a scope from every definition production leaf', () => {
  const modules: readonly MetricSource[] = [
    sourceWithLines(['void 0;']),
    { path: 'src/definition/index.ts', source: 'export {};\n' },
    { path: 'src/definition/validation/nested.ts', source: 'export {};\n' },
    { path: 'src/transition/decision.ts', source: 'export {};\n' },
  ];

  expect(sourceMetricScope(modules, 'PR4a')).toEqual([
    'src/definition/example.ts',
    'src/definition/validation/nested.ts',
  ]);
  expect(
    sourceMetricScope(
      [...modules, { path: 'src/definition/new-leaf.ts', source: 'export {};\n' }],
      'PR4a',
    ),
  ).toContain('src/definition/new-leaf.ts');
});

test('derives the complete PR4b integrity scope without decide or a grandfather list', () => {
  const modules: readonly MetricSource[] = [
    { path: 'src/transition/compiled/a.ts', source: 'export {};\n' },
    { path: 'src/transition/compiled/nested/b.ts', source: 'export {};\n' },
    { path: 'src/transition/decode-compiled-pipeline.ts', source: 'export {};\n' },
    { path: 'src/transition/decide-pipeline.ts', source: 'export {};\n' },
    { path: 'src/transition/index.ts', source: 'export {};\n' },
    sourceWithLines(['void 0;']),
  ];

  expect(sourceMetricScope(modules, 'PR4b')).toEqual([
    'src/transition/compiled/a.ts',
    'src/transition/compiled/nested/b.ts',
    'src/transition/decode-compiled-pipeline.ts',
  ]);
  expect(
    sourceMetricScope(
      [...modules, { path: 'src/transition/compiled/new-leaf.ts', source: 'export {};\n' }],
      'PR4b',
    ),
  ).toContain('src/transition/compiled/new-leaf.ts');
});

test('derives the complete PR4c scope from every transition production leaf', () => {
  const modules: readonly MetricSource[] = [
    { path: 'src/transition/compiled/a.ts', source: 'export {};\n' },
    { path: 'src/transition/context/a.ts', source: 'export {};\n' },
    { path: 'src/transition/evaluation/nested/a.ts', source: 'export {};\n' },
    { path: 'src/transition/facts/a.ts', source: 'export {};\n' },
    { path: 'src/transition/decide-pipeline.ts', source: 'export {};\n' },
    { path: 'src/transition/decode-compiled-pipeline.ts', source: 'export {};\n' },
    { path: 'src/transition/index.ts', source: 'export {};\n' },
    sourceWithLines(['void 0;']),
  ];
  expect(sourceMetricScope(modules, 'PR4c')).toEqual([
    'src/transition/compiled/a.ts',
    'src/transition/context/a.ts',
    'src/transition/decide-pipeline.ts',
    'src/transition/decode-compiled-pipeline.ts',
    'src/transition/evaluation/nested/a.ts',
    'src/transition/facts/a.ts',
  ]);
  expect(
    sourceMetricScope(
      [...modules, { path: 'src/transition/new/nested.ts', source: 'export {};\n' }],
      'PR4c',
    ),
  ).toContain('src/transition/new/nested.ts');
});

test('derives the complete graph scope from every non-barrel TypeScript leaf', () => {
  const modules: readonly MetricSource[] = [
    { path: 'src/graph/index.ts', source: 'export {};\n' },
    { path: 'src/graph/nested/index.ts', source: 'export {};\n' },
    { path: 'src/graph/graph-kernel.ts', source: 'export type GraphKernel = {};\n' },
    { path: 'src/graph/collect.ts', source: 'export const collect = () => [];\n' },
    { path: 'src/graph/deep/nested/reach.ts', source: 'export const reach = () => [];\n' },
    { path: 'src/graph/readme.md', source: '# ignored\n' },
    sourceWithLines(['void 0;']),
  ];

  expect(sourceMetricScope(modules, 'graph')).toEqual([
    'src/graph/collect.ts',
    'src/graph/deep/nested/reach.ts',
    'src/graph/graph-kernel.ts',
  ]);
  expect(
    sourceMetricScope(
      [...modules, { path: 'src/graph/new-leaf.ts', source: 'export type Next = {};\n' }],
      'graph',
    ),
  ).toContain('src/graph/new-leaf.ts');
});

test('keeps renamed graph leaves inside the 250/80 enforcement boundaries', () => {
  const renamedPath = 'src/graph/renamed-runtime-leaf.ts';
  const graphSource = (lines: readonly string[]): MetricSource => ({
    path: renamedPath,
    source: `${lines.join('\n')}\n`,
  });
  const scope = (source: MetricSource): readonly string[] => sourceMetricScope([source], 'graph');
  const fileAtLimit = graphSource([
    'export const renamed = (): void => {};',
    ...Array.from({ length: 249 }, () => 'void 0;'),
  ]);
  const fileOverLimit = graphSource([
    'export const renamed = (): void => {};',
    ...Array.from({ length: 250 }, () => 'void 0;'),
  ]);
  const callableAtLimit = graphSource([
    'export const renamed = () => {',
    ...Array.from({ length: 78 }, () => '  void 0;'),
    '};',
  ]);
  const callableOverLimit = graphSource([
    'export const renamed = () => {',
    ...Array.from({ length: 79 }, () => '  void 0;'),
    '};',
  ]);

  expect(scope(fileAtLimit)).toEqual([renamedPath]);
  expect(() => validateSourceMetrics([fileAtLimit], scope(fileAtLimit))).not.toThrow();
  expect(() => validateSourceMetrics([fileOverLimit], scope(fileOverLimit))).toThrowError(
    '[production-leaf-span]',
  );
  expect(() => validateSourceMetrics([callableAtLimit], scope(callableAtLimit))).not.toThrow();
  expect(() => validateSourceMetrics([callableOverLimit], scope(callableOverLimit))).toThrowError(
    '[production-callable-span]',
  );
});

test('enforces the inclusive formatted physical leaf boundary', () => {
  expect(() =>
    validateSourceMetrics([sourceWithLines(Array.from({ length: 250 }, () => 'void 0;'))], [path]),
  ).not.toThrow();
  expectViolation(
    sourceWithLines(Array.from({ length: 251 }, () => 'void 0;')),
    'production-leaf-span',
  );
});

test('publishes 60 lines as an advisory target without enforcing it', () => {
  expect(ADVISORY_CALLABLE_LINES).toBe(60);
  expect(() =>
    validateSourceMetrics([callable('export function example() {', '}', 61)], [path]),
  ).not.toThrow();
});

describe.each([
  ['function declaration', 'export function example() {', '}'],
  ['function expression', 'export const example = function () {', '};'],
  ['arrow function', 'export const example = () => {', '};'],
  ['class method', 'export class Example {\n  method() {', '  }\n}'],
  ['constructor', 'export class Example {\n  constructor() {', '  }\n}'],
  ['getter', 'export class Example {\n  get value() {', '  }\n}'],
  ['setter', 'export class Example {\n  set value(input: unknown) {', '  }\n}'],
  ['object method', 'export const example = {\n  method() {', '  },\n};'],
] as const)('recursive runtime callable measurement: %s', (_name, opening, closing) => {
  test('accepts 80 and rejects 81 lines', () => {
    expect(() => validateSourceMetrics([callable(opening, closing, 80)], [path])).not.toThrow();
    expectViolation(callable(opening, closing, 81), 'production-callable-span');
  });
});

test('detects an oversized callable nested inside another callable', () => {
  const nested = callable('  const nested = () => {', '  };', 81).source.trimEnd();
  const source = sourceWithLines(['export const outer = () => {', nested, '};']);
  expect(() => validateSourceMetrics([source], [path])).toThrowError('[production-callable-span]');
});

test.each([
  ['declared function', bodyless('export declare function example(', '): void;')],
  [
    'abstract method',
    bodyless('export abstract class Example {\n  abstract method(', '  ): void;\n}'),
  ],
  [
    'constructor overload',
    bodyless(
      'export class Example {\n  constructor(',
      '  );\n  constructor() {\n    void 0;\n  }\n}',
    ),
  ],
  [
    'abstract getter',
    bodyless('export abstract class Example {\n  abstract get value():', '  string;\n}'),
  ],
  [
    'abstract setter',
    bodyless('export abstract class Example {\n  abstract set value(', '  input: string);\n}'),
  ],
] as const)('excludes bodyless %s declarations', (_name, source) => {
  expect(() => validateSourceMetrics([source], [path])).not.toThrow();
});
