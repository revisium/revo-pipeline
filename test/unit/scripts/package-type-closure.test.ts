import { expect, test } from 'vitest';

import {
  planTypeClosure,
  satisfiesTypeDependencyRange,
  type TypeClosureInput,
} from '../../../scripts/package/package-type-closure.js';

const closure = (): TypeClosureInput => ({
  rootName: '@types/node',
  rootRange: '24.13.3',
  rootVersion: '24.13.3',
  nodes: [
    {
      name: '@types/node',
      version: '24.13.3',
      sourceId: 'node-source',
      manifestDependencies: { 'undici-types': '~7.18.0' },
      snapshotDependencies: { 'undici-types': '7.18.2' },
    },
    {
      name: 'undici-types',
      version: '7.18.2',
      sourceId: 'undici-source',
      manifestDependencies: {},
      snapshotDependencies: {},
    },
  ],
});

test('plans the current and a non-hoisted three-level closure deterministically', () => {
  const current = planTypeClosure(closure());
  expect(current).toEqual([
    { name: 'undici-types', version: '7.18.2', sourceId: 'undici-source' },
    { name: '@types/node', version: '24.13.3', sourceId: 'node-source' },
  ]);
  expect(Object.isFrozen(current)).toBe(true);
  expect(current.every(Object.isFrozen)).toBe(true);

  const input = closure();
  const nested: TypeClosureInput = {
    ...input,
    nodes: [
      {
        ...input.nodes[0]!,
        manifestDependencies: { middle: '^1.0.0' },
        snapshotDependencies: { middle: '1.4.0' },
      },
      {
        name: 'leaf',
        version: '0.2.4',
        sourceId: 'parent-local-leaf',
        manifestDependencies: {},
        snapshotDependencies: {},
      },
      {
        name: 'middle',
        version: '1.4.0',
        sourceId: 'parent-local-middle',
        manifestDependencies: { leaf: '^0.2.3' },
        snapshotDependencies: { leaf: '0.2.4' },
      },
    ],
  };
  expect(planTypeClosure(nested).map(({ name }) => name)).toEqual([
    'leaf',
    'middle',
    '@types/node',
  ]);
  expect(planTypeClosure({ ...nested, nodes: [...nested.nodes].reverse() })).toEqual(
    planTypeClosure(nested),
  );
});

test.each([
  ['1.2.3', '1.2.3', true],
  ['1.2.3', '1.2.4', false],
  ['1.2.3', '1.2.2', false],
  ['1.2.3', '1.2.2', false],
  ['~7.18.0', '7.18.0', true],
  ['~7.18.0', '7.18.2', true],
  ['~7.18.0', '7.17.99', false],
  ['~7.18.0', '7.19.0', false],
  ['^24.13.3', '24.13.3', true],
  ['^24.13.3', '24.99.99', true],
  ['^24.13.3', '24.13.2', false],
  ['^24.13.3', '25.0.0', false],
  ['^0.2.3', '0.2.3', true],
  ['^0.2.3', '0.2.99', true],
  ['^0.2.3', '0.2.2', false],
  ['^0.2.3', '0.3.0', false],
  ['^0.0.3', '0.0.3', true],
  ['^0.0.3', '0.0.2', false],
  ['^0.0.3', '0.0.4', false],
] as const)('evaluates %s against %s', (range, selected, expected) => {
  expect(satisfiesTypeDependencyRange(range, selected)).toBe(expected);
});

test.each([
  ' 1.2.3',
  '1.2',
  '1.x.0',
  '>=1.2.3',
  '1.2.3 || 2.0.0',
  'latest',
  'workspace:*',
  '1.2.3-beta.1',
  '1.2.3+build',
  '01.2.3',
  '-1.2.3',
  '9007199254740992.0.0',
  '1.2.3 ',
  '^ 1.2.3',
  '~1.2.3.4',
])('rejects unsupported range %s', (range) => {
  expect(() => satisfiesTypeDependencyRange(range, '1.2.3')).toThrow(
    '[package-type-range-unsupported]',
  );
});

test.each([
  (input: TypeClosureInput): TypeClosureInput => ({ ...input, nodes: input.nodes.slice(0, 1) }),
  (input: TypeClosureInput): TypeClosureInput => ({
    ...input,
    nodes: [
      ...input.nodes,
      {
        name: 'extra',
        version: '1.0.0',
        sourceId: 'extra',
        manifestDependencies: {},
        snapshotDependencies: {},
      },
    ],
  }),
  (input: TypeClosureInput): TypeClosureInput => ({
    ...input,
    nodes: [...input.nodes, { ...input.nodes[1]!, version: '7.18.3' }],
  }),
  (input: TypeClosureInput): TypeClosureInput => ({
    ...input,
    nodes: [
      {
        ...input.nodes[0]!,
        snapshotDependencies: { 'undici-types': '7.18.3' },
      },
      input.nodes[1]!,
    ],
  }),
  (input: TypeClosureInput): TypeClosureInput => ({
    ...input,
    nodes: [
      {
        ...input.nodes[0]!,
        manifestDependencies: { '@types/node': '24.13.3' },
        snapshotDependencies: { '@types/node': '24.13.3' },
      },
      input.nodes[1]!,
    ],
  }),
  (input: TypeClosureInput): TypeClosureInput => ({
    ...input,
    rootVersion: '24.13.4',
  }),
  (input: TypeClosureInput): TypeClosureInput => ({
    ...input,
    nodes: [
      {
        ...input.nodes[0]!,
        manifestDependencies: { middle: '^1.0.0' },
        snapshotDependencies: { middle: '1.0.0' },
      },
      {
        name: 'middle',
        version: '1.0.0',
        sourceId: 'middle',
        manifestDependencies: { leaf: '^1.0.0' },
        snapshotDependencies: { leaf: '1.0.0' },
      },
      {
        name: 'leaf',
        version: '1.0.0',
        sourceId: 'leaf',
        manifestDependencies: { middle: '^1.0.0' },
        snapshotDependencies: { middle: '1.0.0' },
      },
    ],
  }),
] as const)('rejects closure inconsistency %#', (mutate) => {
  expect(() => planTypeClosure(mutate(closure()))).toThrow('[package-type-closure]');
});
