import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import { EmptyObjectSchema } from '../../../src/foundation/index.js';
import type { PipelineSourcePackage } from '../../../src/source/index.js';
import { materializationFor, singleSelection } from '../../support/compiler-builders.js';
import { sourceForNode, sourceNodeBuilders } from '../../support/source-builders.js';

const successful = (
  source: PipelineSourcePackage,
  materialization = materializationFor(source),
) => {
  const result = compilePipeline(source, materialization);
  if (!result.ok) {
    throw new TypeError(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
  }
  return result;
};

const generatedChoice = (program: ReturnType<typeof successful>['program']) => {
  const choice = program.modules[0].region.nodes.find(({ kind }) => kind === 'choice');
  if (choice?.kind !== 'choice') {
    throw new TypeError('Expected generated choice.');
  }
  return choice;
};

describe('generated lowering topology', () => {
  it('emits the complete slot-single activity, requirement, and provenance', () => {
    const source = sourceForNode(sourceNodeBuilders.agent());
    const result = successful(source, materializationFor(source, singleSelection()));
    const module = result.program.modules.find(({ key }) => key === result.program.entryModule);
    const activity = module?.region.nodes.find(({ kind }) => kind === 'activity');
    const end = module?.region.nodes.find(({ kind }) => kind === 'end');
    if (activity?.kind !== 'activity' || end?.kind !== 'end') {
      throw new TypeError('Expected slot-single activity and end.');
    }

    expect(activity).toEqual({
      kind: 'activity',
      id: 'sha256:f7a49fc034aec8a4727c5cfa366f1e96ac679a20095d8369ae2b17df64e1c26e',
      activityKind: 'agent',
      requirementKey: 'reviewer-binding',
      input: {},
      inputSchema: EmptyObjectSchema,
      outputSchema: EmptyObjectSchema,
      routes: { succeeded: end.id, failed: end.id, cancelled: end.id },
    });
    expect(end.id).toBe('sha256:7388e9d9d2d01d94be0ebfed33faf046f9ad740d839fb27ad18c65a10335def2');
    expect(module?.region.entry).toBe(activity.id);
    expect(result.requirements).toEqual({
      schemaVersion: 'pipeline-requirements/v1',
      entries: [
        {
          kind: 'agent',
          key: 'reviewer-binding',
          bindingKey: 'reviewer-binding',
          inputSchema: EmptyObjectSchema,
          outputSchema: EmptyObjectSchema,
        },
      ],
    });
    expect(result.provenance.requirements).toEqual([
      {
        requirementKey: 'reviewer-binding',
        sourcePaths: ['/modules/0/region/nodes/0'],
        materializationPaths: ['/slots/0/selection/participant'],
      },
    ]);
  });

  it('emits the exact generic-parallel routing table', () => {
    const result = successful(sourceForNode(sourceNodeBuilders.parallel()));
    const choice = generatedChoice(result.program);
    const parallel = result.program.modules[0].region.nodes.find(
      (node) => node.kind === 'parallel' && node.mode === 'generic',
    );
    if (parallel?.kind !== 'parallel' || parallel.mode !== 'generic') {
      throw new TypeError('Expected generic parallel.');
    }

    const target = choice.cases[0].target;
    expect(choice).toEqual({
      kind: 'choice',
      id: 'sha256:ca6cf3dbc6dfc67e19b4aaffb8faeaae9a4278efee54b0a98d3b811510ff86d1',
      selector: { kind: 'nodeOutput', nodeId: parallel.id, pointer: '/classification' },
      cases: [
        { key: 'cancelled', when: { kind: 'equals', value: 'cancelled' }, target },
        { key: 'completed', when: { kind: 'equals', value: 'completed' }, target },
        { key: 'failed', when: { kind: 'equals', value: 'failed' }, target },
        { key: 'impossible', when: { kind: 'equals', value: 'impossible' }, target },
      ],
      otherwise: null,
    });
    expect(parallel).toMatchObject({
      id: 'sha256:0850c1cd1ae717ed79e795935ed929b426fbae40e5a81b64604b7d0a92467761',
      kind: 'parallel',
      mode: 'generic',
      policy: { kind: 'all' },
      remaining: 'drain',
      next: choice.id,
    });
    expect(
      parallel.branches.map(({ key, input, exits, region }) => ({
        key,
        input,
        exits,
        inputSchema: region.inputSchema,
        outputSchema: region.outputSchema,
        regionExits: region.exits,
        nodeKinds: region.nodes.map(({ kind }) => kind),
      })),
    ).toEqual([
      {
        key: 'left',
        input: {},
        exits: [{ outcome: 'ok', classification: 'qualifies' }],
        inputSchema: EmptyObjectSchema,
        outputSchema: EmptyObjectSchema,
        regionExits: [{ outcome: 'ok', outputSchema: EmptyObjectSchema }],
        nodeKinds: ['end'],
      },
      {
        key: 'right',
        input: {},
        exits: [{ outcome: 'ok', classification: 'qualifies' }],
        inputSchema: EmptyObjectSchema,
        outputSchema: EmptyObjectSchema,
        regionExits: [{ outcome: 'ok', outputSchema: EmptyObjectSchema }],
        nodeKinds: ['end'],
      },
    ]);
    expect(result.requirements.entries).toEqual([]);
    expect(
      result.provenance.nodes.find(({ programNodeId }) => programNodeId === choice.id),
    ).toEqual({
      programNodeId: choice.id,
      sourcePath: '/modules/0/region/nodes/0',
      materializationPath: null,
      loweringRole: 'genericParallelChoice',
      ordinal: 0,
    });
  });
});
