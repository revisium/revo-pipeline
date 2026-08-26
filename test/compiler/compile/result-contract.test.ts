import { Compile } from 'typebox/compile';
import { describe, expect, it } from 'vitest';

import { PipelineCompileResultSchema } from '../../../src/compiler/index.js';
import { compilePipeline } from '../../../src/compiler/index.js';
import { createPipelineDiagnostic } from '../../../src/foundation/index.js';
import type { PipelineSourcePackage } from '../../../src/source/index.js';
import { consensusAgentNode, materializationFor } from '../../support/compiler-builders.js';
import {
  endNode,
  sourceForNode,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../../support/source-builders.js';

const validator = Compile(PipelineCompileResultSchema);

describe('closed compiler result contract', () => {
  it('accepts catalog-backed failures and rejects partial or invented diagnostics', () => {
    const failure = {
      ok: false,
      diagnostics: [createPipelineDiagnostic('LINK_MODULE_MISSING', '/module')],
    };

    expect(validator.Check(failure)).toBe(true);
    expect(validator.Check({ ...failure, programDigest: `sha256:${'0'.repeat(64)}` })).toBe(false);
    expect(
      validator.Check({
        ok: false,
        diagnostics: [{ ...failure.diagnostics[0], code: 'LINK_INVENTED' }],
      }),
    ).toBe(false);
  });

  const phaseFailures = (): readonly {
    readonly phase: string;
    readonly family: string;
    readonly source: unknown;
    readonly materialization: unknown;
  }[] => {
    const materializedSource = sourceForNode(consensusAgentNode());
    const missingModule = sourceForNode(sourceNodeBuilders.call());
    const dataflow = sourceForNode({
      ...sourceNodeBuilders.script(),
      input: { value: { kind: 'literal', value: true } },
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
    });
    const bounded: PipelineSourcePackage = {
      ...sourceForNode(sourceNodeBuilders.consensus()),
      maximumTotalActivities: 1,
    };
    const conflict = sourceWithNodes([
      {
        ...sourceNodeBuilders.script(),
        id: 'first',
        routes: { succeeded: 'second', failed: 'done', cancelled: 'done' },
      },
      {
        ...sourceNodeBuilders.script(),
        id: 'second',
        script: { id: 'script:different', version: 1 },
      },
      endNode(),
    ]);
    return [
      { phase: 'source', family: 'CANONICAL', source: null, materialization: null },
      {
        phase: 'materialization',
        family: 'MATERIALIZATION',
        source: materializedSource,
        materialization: materializationFor(materializedSource, {
          strategy: 'consensus',
          participants: [{ key: 'only', bindingKey: 'only-binding' }],
        }),
      },
      {
        phase: 'link',
        family: 'LINK',
        source: missingModule,
        materialization: materializationFor(missingModule),
      },
      {
        phase: 'dataflow',
        family: 'DATA',
        source: dataflow,
        materialization: materializationFor(dataflow),
      },
      {
        phase: 'bounds',
        family: 'BOUND',
        source: bounded,
        materialization: materializationFor(bounded),
      },
      {
        phase: 'emission',
        family: 'REQUIREMENT',
        source: conflict,
        materialization: materializationFor(conflict),
      },
    ];
  };

  it.each(phaseFailures())(
    '$phase failure exposes diagnostics and no partial artifact',
    (fixture) => {
      const result = compilePipeline(fixture.source, fixture.materialization);

      expect(result).toMatchObject({ ok: false, diagnostics: [{ family: fixture.family }] });
      expect(Object.keys(result).toSorted()).toEqual(['diagnostics', 'ok']);
      expect(validator.Check(result)).toBe(true);
    },
  );
});
