import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import type { PipelineSourcePackage, SourceNode } from '../../../src/source/index.js';
import {
  consensusAgentNode,
  consensusSelection,
  materializationFor,
  singleSelection,
} from '../../support/compiler-builders.js';
import { consensusIdentityRecords } from '../../support/compiler-vectors.js';
import {
  childRegion,
  emptySchema,
  sourceForNode,
  sourceNodeBuilders,
} from '../../support/source-builders.js';

const successful = (
  source: PipelineSourcePackage,
  selection?: ReturnType<typeof singleSelection>,
) => {
  const result = compilePipeline(source, materializationFor(source, selection));
  if (!result.ok) {
    throw new TypeError(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
  }
  return result;
};

const vector = (
  source: PipelineSourcePackage,
  materialization = materializationFor(source),
): { readonly programDigest: string; readonly provenance: readonly string[] } => {
  const result = compilePipeline(source, materialization);
  if (!result.ok) {
    throw new TypeError(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
  }
  return {
    programDigest: result.programDigest,
    provenance: result.provenance.nodes.map(
      ({ programNodeId, loweringRole, ordinal, sourcePath, materializationPath }) =>
        [programNodeId, loweringRole, ordinal, sourcePath, materializationPath ?? '-'].join('|'),
    ),
  };
};

const root =
  'sha256:505866bbfaecb35b1838a9ce879c0dc320a4e54885069bfbe0ffebe466360eba|direct|0|/modules/0/region|-';
const done =
  'sha256:7388e9d9d2d01d94be0ebfed33faf046f9ad740d839fb27ad18c65a10335def2|direct|0|/modules/0/region/nodes/1|-';

const consensusVector = (materialized: boolean): readonly string[] =>
  [
    ...consensusIdentityRecords.map(
      ({ programNodeId, loweringRole, ordinal, participantIndex }) => {
        const materializationPath = materialized
          ? participantIndex === null
            ? '/activity'
            : `/activity/participants/${participantIndex}`
          : '-';
        return `${programNodeId}|${loweringRole}|${ordinal}|/modules/0/region/nodes/0|${materializationPath}`;
      },
    ),
    root,
    done,
  ].toSorted();

const linkedCallSource = (): PipelineSourcePackage => {
  const source = sourceForNode(sourceNodeBuilders.call());
  return {
    ...source,
    modules: [
      ...source.modules,
      {
        key: 'child-module',
        inputSchema: emptySchema(),
        outputSchema: emptySchema(),
        region: childRegion('child-region'),
      },
    ],
  };
};

const validMap = (): SourceNode => ({
  ...sourceNodeBuilders.map(),
  items: { kind: 'literal', value: [{ id: 'first' }] },
  itemKeyPointer: '/id',
});

const directId = 'sha256:0850c1cd1ae717ed79e795935ed929b426fbae40e5a81b64604b7d0a92467761';
const targetEntryCases = [
  [
    'agent',
    () => sourceForNode(sourceNodeBuilders.agent()),
    singleSelection(),
    'activity',
    'agentSingleActivity',
    'sha256:f7a49fc034aec8a4727c5cfa366f1e96ac679a20095d8369ae2b17df64e1c26e',
    '/modules/0/region/nodes/0',
    '/activity/participant',
  ],
  [
    'script',
    () => sourceForNode(sourceNodeBuilders.script()),
    undefined,
    'activity',
    'direct',
    directId,
    '/modules/0/region/nodes/0',
    null,
  ],
  [
    'choice',
    () => sourceForNode(sourceNodeBuilders.choice()),
    undefined,
    'choice',
    'direct',
    directId,
    '/modules/0/region/nodes/0',
    null,
  ],
  [
    'parallel',
    () => sourceForNode(sourceNodeBuilders.parallel()),
    undefined,
    'parallel',
    'direct',
    directId,
    '/modules/0/region/nodes/0',
    null,
  ],
  [
    'repeat',
    () => sourceForNode(sourceNodeBuilders.repeat()),
    undefined,
    'repeat',
    'direct',
    directId,
    '/modules/0/region/nodes/0',
    null,
  ],
  [
    'map',
    () => sourceForNode(validMap()),
    undefined,
    'map',
    'direct',
    directId,
    '/modules/0/region/nodes/0',
    null,
  ],
  [
    'wait',
    () => sourceForNode(sourceNodeBuilders.wait()),
    undefined,
    'wait',
    'direct',
    directId,
    '/modules/0/region/nodes/0',
    null,
  ],
  [
    'humanGate',
    () => sourceForNode(sourceNodeBuilders.humanGate()),
    undefined,
    'humanGate',
    'direct',
    directId,
    '/modules/0/region/nodes/0',
    null,
  ],
  [
    'consensus',
    () => sourceForNode(sourceNodeBuilders.consensus()),
    undefined,
    'parallel',
    'consensusParallel',
    'sha256:b7398c2a4268cee28f7cb358b4acc06b79f0a5c1a8f07c8a3d92897b42117bf7',
    '/modules/0/region/nodes/0',
    null,
  ],
  [
    'call',
    linkedCallSource,
    undefined,
    'call',
    'direct',
    'sha256:ff6c1457d0aae10dc5be353789cc34d16b1f3803f101d0b4a7e7102681683cc8',
    '/modules/1/region/nodes/0',
    null,
  ],
  [
    'end',
    () => sourceForNode(sourceNodeBuilders.end()),
    undefined,
    'end',
    'direct',
    directId,
    '/modules/0/region/nodes/0',
    null,
  ],
] as const;

describe('compiler lowering digest and full-ID vectors', () => {
  it.each(targetEntryCases)(
    'pins the $0 source target entry',
    (
      _sourceKind,
      createSource,
      selection,
      programKind,
      loweringRole,
      programNodeId,
      sourcePath,
      materializationPath,
    ) => {
      const result = successful(createSource(), selection);
      const entryModule = result.program.modules.find(
        ({ key }) => key === result.program.entryModule,
      );
      const entry = entryModule?.region.nodes.find(({ id }) => id === entryModule.region.entry);
      const provenance = result.provenance.nodes.find(
        (record) => record.programNodeId === entry?.id,
      );

      expect(entry).toMatchObject({ kind: programKind, id: programNodeId });
      expect(provenance).toEqual({
        programNodeId,
        sourceNodeId: 'activity',
        sourcePath,
        materializationPath,
        loweringRole,
        ordinal: 0,
      });
    },
  );

  it('pins slot-single IDs, roles, source/materialization paths, and digest', () => {
    const source = sourceForNode(sourceNodeBuilders.agent());
    expect(vector(source, materializationFor(source, singleSelection()))).toEqual({
      programDigest: 'sha256:b4bdf983b8a1920afe6357ecbf85545ebcc7842e5b8a8258ef05c04573cc8428',
      provenance: [
        root,
        done,
        'sha256:f7a49fc034aec8a4727c5cfa366f1e96ac679a20095d8369ae2b17df64e1c26e|agentSingleActivity|0|/modules/0/region/nodes/0|/activity/participant',
      ].toSorted(),
    });
  });

  it('pins generic-parallel IDs, roles, paths, and digest', () => {
    const source = sourceForNode(sourceNodeBuilders.parallel());
    expect(vector(source)).toEqual({
      programDigest: 'sha256:b55e169ea78a6c1a25d049706425d0b2dbd156dbd2e329308733446683132395',
      provenance: [
        'sha256:0850c1cd1ae717ed79e795935ed929b426fbae40e5a81b64604b7d0a92467761|direct|0|/modules/0/region/nodes/0|-',
        'sha256:43645f9a39aea76a64e91625511bbd204ad13b6d3c8aac3c3b996c13f96ee0e7|direct|0|/modules/0/region/nodes/0/branches/0/region/nodes/0|-',
        root,
        done,
        'sha256:c5e985510ad91e2c5a91e3b11ad4010af4f1d7d4c2f998bf9224030e61a63164|direct|0|/modules/0/region/nodes/0/branches/0/region|-',
        'sha256:ca6cf3dbc6dfc67e19b4aaffb8faeaae9a4278efee54b0a98d3b811510ff86d1|genericParallelChoice|0|/modules/0/region/nodes/0|-',
        'sha256:d53e05839d86fa1f64f692cf4848878fa272b497e7e5cc03998725481969e719|direct|0|/modules/0/region/nodes/0/branches/1/region/nodes/0|-',
        'sha256:f01e1dcf861a98f7067d8661f5722a08de08a11185209ff1430a6188862ef8ab|direct|0|/modules/0/region/nodes/0/branches/1/region|-',
      ].toSorted(),
    });
  });

  it('pins explicit-consensus IDs, roles, ordinals, paths, and digest', () => {
    expect(vector(sourceForNode(sourceNodeBuilders.consensus()))).toEqual({
      programDigest: 'sha256:b752d0596dea5c9305c8986145fe184a7c9cebf38cf313ad08788047099a15fd',
      provenance: consensusVector(false),
    });
  });

  it('pins slot-consensus IDs, roles, ordinals, paths, and digest', () => {
    const source = sourceForNode(consensusAgentNode());
    expect(vector(source, materializationFor(source, consensusSelection()))).toEqual({
      programDigest: 'sha256:bbf7a4365ccb397120912829401c59df4237f843460ee72f4454468877edc4fe',
      provenance: consensusVector(true),
    });
  });
});
