import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../../src/compiler/index.js';
import type { PipelineSourcePackage, ScriptSourceNode } from '../../../src/source/index.js';
import {
  consensusAgentNode,
  consensusSelection,
  materializationFor,
} from '../../support/compiler-builders.js';
import {
  clone,
  endNode,
  sourceForNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../../support/source-builders.js';

const sharedRequirementSource = (conflict = false): PipelineSourcePackage => {
  const first: ScriptSourceNode = {
    ...sourceNodeBuilders.script(),
    id: 'a-first',
    routes: { succeeded: 'b-second', failed: 'done', cancelled: 'done' },
  };
  const second: ScriptSourceNode = {
    ...sourceNodeBuilders.script(),
    id: 'b-second',
    ...(conflict ? { script: { id: 'script:different-script', version: 1 } } : {}),
  };
  return sourceWithNodes([first, second, endNode()]);
};

const success = (source: PipelineSourcePackage) => {
  const result = compilePipeline(source, materializationFor(source));
  if (!result.ok) {
    throw new Error(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
  }
  return result;
};

describe('compiler bundle emission', () => {
  it('deduplicates identical requirements and retains complete provenance', () => {
    const result = success(sharedRequirementSource());

    expect(result.requirements.entries).toHaveLength(1);
    expect(result.provenance.requirements).toEqual([
      {
        requirementKey: 'prepare',
        sourcePaths: ['/modules/0/region/nodes/0', '/modules/0/region/nodes/1'],
        materializationPaths: [],
      },
    ]);
  });

  it('rejects conflicting declarations without partial artifacts', () => {
    const source = sharedRequirementSource(true);
    const result = compilePipeline(source, materializationFor(source));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ family: 'REQUIREMENT', code: 'REQUIREMENT_CONFLICT' }],
    });
    expect(Object.keys(result).toSorted()).toEqual(['diagnostics', 'ok']);
  });

  it('owns, recursively freezes, and survives a JSON round trip', () => {
    const source = sourceForNode(sourceNodeBuilders.script());
    const result = success(source);

    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result.program.modules[0]).not.toBe(source.modules[0]);
    expect(Object.isFrozen(result.program)).toBe(true);
    expect(Object.isFrozen(result.requirements.entries)).toBe(true);
    expect(Object.isFrozen(result.provenance.nodes)).toBe(true);
  });

  it('is deterministic across equivalent caller property order', () => {
    const source = sourceForNode(sourceNodeBuilders.script());
    const reordered = clone({
      modules: source.modules,
      maximumTotalActivities: source.maximumTotalActivities,
      entryModule: source.entryModule,
      key: source.key,
      schemaVersion: source.schemaVersion,
    });

    expect(success(reordered)).toEqual(success(source));
  });

  it('is deterministic across source keyed-set permutations', () => {
    const consensus = sourceNodeBuilders.consensus();
    const parallel = sourceNodeBuilders.parallel();
    const consensusSource = sourceForNode(consensus);
    const consensusPermuted = sourceForNode({
      ...consensus,
      participants: [consensus.participants[1], consensus.participants[0]],
    });
    const parallelSource = sourceForNode(parallel);
    const parallelPermuted = sourceForNode({
      ...parallel,
      branches: [parallel.branches[1], parallel.branches[0]],
    });

    expect(success(consensusPermuted)).toEqual(success(consensusSource));
    expect(success(parallelPermuted)).toEqual(success(parallelSource));
  });

  it('is deterministic across materialized participant permutations', () => {
    const source = sourceForNode(consensusAgentNode());
    const selection = consensusSelection();
    const canonical = materializationFor(source, selection);
    const permuted = materializationFor(source, {
      ...selection,
      participants: [selection.participants[1], selection.participants[0]],
    });

    expect(compilePipeline(source, permuted)).toEqual(compilePipeline(source, canonical));
  });

  it('pins the full compiler bundle digest and synthesized ID vectors', () => {
    const result = success(sourceForNode(sourceNodeBuilders.script()));

    expect({
      sourceDigest: result.sourceDigest,
      materializationDigest: result.materializationDigest,
      programDigest: result.programDigest,
      ids: result.provenance.nodes.map(({ programNodeId }) => programNodeId),
    }).toEqual({
      sourceDigest: 'sha256:dc5813b5e8c0c8258744b51e0c14fb24ba5d2c77ccf973a8eb0b39fe224d809a',
      materializationDigest:
        'sha256:6731fe281e14ad959ea6b5f3cb4eb8012ab7f43137f49145064fbba35164d4e6',
      programDigest: 'sha256:3361eb00efac5f36427a66307610b0bf4c9df54073465f2875aee43025186af2',
      ids: [
        'sha256:0850c1cd1ae717ed79e795935ed929b426fbae40e5a81b64604b7d0a92467761',
        'sha256:505866bbfaecb35b1838a9ce879c0dc320a4e54885069bfbe0ffebe466360eba',
        'sha256:7388e9d9d2d01d94be0ebfed33faf046f9ad740d839fb27ad18c65a10335def2',
      ],
    });
  });
});
