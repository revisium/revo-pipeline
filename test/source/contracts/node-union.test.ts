import { Compile } from 'typebox/compile';
import { describe, expect, it } from 'vitest';

import { SourceNodeSchema, SourceRegionSchema } from '../../../src/source/index.js';
import { allSourceNodeExamples, sourceForNode } from '../../support/source-builders.js';
import { expectValidSource } from '../../support/source-validation.js';

const nodeValidator = Compile(SourceNodeSchema);
const regionValidator = Compile(SourceRegionSchema);

const sourceRegionFields = [
  'key',
  'inputSchema',
  'entry',
  'outputSchema',
  'exits',
  'nodes',
] as const;
const requiredSourceRegionFields = ['key', 'entry', 'outputSchema', 'exits', 'nodes'] as const;
const sourceExitFields = ['outcome', 'outputSchema'] as const;

const sourceNodeShapeVectors = [
  ['agent', ['kind', 'key', 'slotKey', 'strategies', 'input', 'inputSchema', 'outputSchema']],
  [
    'script',
    ['kind', 'key', 'requirementKey', 'script', 'input', 'inputSchema', 'outputSchema', 'routes'],
  ],
  [
    'effect',
    [
      'kind',
      'key',
      'requirementKey',
      'effectKey',
      'input',
      'inputSchema',
      'outputSchema',
      'routes',
    ],
  ],
  ['choice', ['kind', 'key', 'selector', 'cases', 'otherwise']],
  ['parallel', ['kind', 'key', 'branches', 'policy', 'remaining', 'routes']],
  [
    'repeat',
    [
      'kind',
      'key',
      'maximumIterations',
      'initialInput',
      'nextInput',
      'body',
      'bodyExits',
      'continueWhen',
      'output',
      'outputSchema',
      'routes',
    ],
  ],
  [
    'map',
    [
      'kind',
      'key',
      'items',
      'itemKeyPointer',
      'maximumItems',
      'maximumConcurrency',
      'bodyInput',
      'body',
      'bodyExits',
      'failure',
      'routes',
    ],
  ],
  ['wait', ['kind', 'key', 'wait', 'routes']],
  ['humanGate', ['kind', 'key', 'subject', 'answers', 'authorizationRequirements', 'routes']],
  ['consensus', ['kind', 'key', 'participants', 'policy', 'remaining', 'routes']],
  ['call', ['kind', 'key', 'module', 'input', 'outputSchema', 'routes']],
  ['end', ['kind', 'key', 'outcome', 'output']],
] as const;

describe('source node union', () => {
  it.each(sourceNodeShapeVectors)(
    'pins the independent %s runtime shape vector',
    (kind, fields) => {
      const node = allSourceNodeExamples().find((candidate) => candidate.kind === kind);
      expect(node).toBeDefined();
      if (node === undefined) {
        throw new TypeError('Expected a source node shape fixture.');
      }
      expect(Object.keys(node).toSorted()).toEqual([...fields].toSorted());
      expect(nodeValidator.Check(node)).toBe(true);
      expect(nodeValidator.Check({ ...node, undeclared: true })).toBe(false);
      for (const field of fields) {
        const incomplete: Record<string, unknown> = { ...node };
        delete incomplete[field];
        expect(nodeValidator.Check(incomplete)).toBe(false);
      }
    },
  );

  it.each(allSourceNodeExamples().map((node) => [node.kind, node] as const))(
    'validates a complete local region containing %s',
    (_kind, node) => {
      expect(expectValidSource(sourceForNode(node)).source.modules).toHaveLength(1);
    },
  );

  it('pins the independent SourceRegion and exit runtime shapes', () => {
    const node = allSourceNodeExamples()[0];
    expect(node).toBeDefined();
    if (node === undefined) {
      throw new TypeError('Expected a source node fixture.');
    }
    const region = sourceForNode(node).modules[0]?.region;
    expect(region).toBeDefined();
    if (region === undefined) {
      throw new TypeError('Expected a source region fixture.');
    }
    const exit = region.exits[0];
    expect(exit).toBeDefined();
    if (exit === undefined) {
      throw new TypeError('Expected a source region exit fixture.');
    }

    expect(Object.keys(region).toSorted()).toEqual([...sourceRegionFields].toSorted());
    expect(Object.keys(exit).toSorted()).toEqual([...sourceExitFields].toSorted());
    expect(regionValidator.Check(region)).toBe(true);
    expect(regionValidator.Check({ ...region, undeclared: true })).toBe(false);
    expect(regionValidator.Check({ ...region, exits: [{ ...exit, undeclared: true }] })).toBe(
      false,
    );

    const withoutOptionalInput: Record<string, unknown> = { ...region };
    delete withoutOptionalInput.inputSchema;
    expect(regionValidator.Check(withoutOptionalInput)).toBe(true);

    for (const field of requiredSourceRegionFields) {
      const incomplete: Record<string, unknown> = { ...region };
      delete incomplete[field];
      expect(regionValidator.Check(incomplete)).toBe(false);
    }
    for (const field of sourceExitFields) {
      const incompleteExit: Record<string, unknown> = { ...exit };
      delete incompleteExit[field];
      expect(regionValidator.Check({ ...region, exits: [incompleteExit] })).toBe(false);
    }
  });

  it.each(allSourceNodeExamples().map((node) => [node.kind, node] as const))(
    'contains a representative %s node in SourceRegionSchema',
    (_kind, node) => {
      const region = sourceForNode(node).modules[0]?.region;
      expect(region).toBeDefined();
      expect(regionValidator.Check(region)).toBe(true);
    },
  );
});
