import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const read = (path: string): string =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

const decoder = read('docs/specs/pipeline-decoding-v1.spec.md');
const reducer = read('docs/specs/pipeline-reducer-v1.spec.md');
const modules = read('docs/specs/internal-module-structure.spec.md');
const architecture = read('docs/architecture.md');
const adr = read('docs/adr/0002-portable-decoding-and-reduction.md');
const scriptAdr = read(
  'docs/adr/0003-native-script-definitions-and-unresolved-execution-templates.md',
);
const definition = read('docs/specs/pipeline-definition-v1.spec.md');
const readme = read('README.md');

const compiledIntegrityModuleMap = `transition/decode-compiled-pipeline.ts
transition/inspect-compiled-pipeline.ts
transition/compiled/
  compiled-inspection-fault.ts
  compiled-inspection-fault-collector.ts
  compiled-inspection.ts
  compiled-capture-limit.ts
  snapshot-compiled-input.ts
  inspect-compiled-members.ts
  inspect-compiled-root-members.ts
  inspect-compiled-node-members.ts
  inspect-compiled-node-policy.ts
  inspect-compiled-node-routes.ts
  inspect-compiled-branch-schema.ts
  inspect-compiled-branch-fallback.ts
  inspect-compiled-edges.ts
  inspect-compiled-facts.ts
  inspect-compiled-indexes.ts
  inspect-compiled-outcomes.ts
  inspect-compiled-regions.ts
  expected-compiled-semantics.ts
  derive-expected-compiled-semantics.ts
  compare-serialized-graph.ts
  verify-serialized-topology.ts
  verify-serialized-indexes.ts`;

const compiledIntegrityDag = `decode-compiled-pipeline / decide-pipeline
  -> inspect-compiled-pipeline
inspect-compiled-pipeline
  -> snapshot-compiled-input
     -> compiled-capture-limit
  -> compiled-inspection-fault-collector -> compiled-inspection-fault
  -> inspect-compiled-members
     -> inspect-compiled-root-members
     -> inspect-compiled-node-members
        -> inspect-compiled-node-policy
        -> inspect-compiled-node-routes
           -> inspect-compiled-branch-schema
              -> inspect-compiled-branch-fallback
        -> inspect-compiled-outcomes
     -> inspect-compiled-edges
     -> inspect-compiled-facts
     -> inspect-compiled-indexes
     -> inspect-compiled-regions
  -> derive-expected-compiled-semantics -> expected-compiled-semantics
  -> compare-serialized-graph -> expected-compiled-semantics
  -> graph barrel
  -> verify-serialized-topology
  -> verify-serialized-indexes
  -> compiled-inspection`;

const fencedBlockAfter = (document: string, marker: string, language: string): string => {
  const block = document
    .split(marker)[1]
    ?.match(new RegExp(`\\\`\\\`\\\`${language}\\n([\\s\\S]*?)\\\`\\\`\\\``))?.[1];
  if (block === undefined) {
    throw new Error(`Missing ${language} block after ${marker}`);
  }
  return block.trim();
};

const manifestAfter = (document: string, marker: string): readonly string[] =>
  fencedBlockAfter(document, marker, 'text').split('\n');

const typeBlock = (document: string, typeName: string): string => {
  const block = document.match(
    new RegExp(
      `export type ${typeName} =[\\s\\S]*?(?=\\nexport (?:type|declare function)|\\n\\\`\\\`\\\`)`,
    ),
  )?.[0];
  if (block === undefined) {
    throw new Error(`Missing type block for ${typeName}`);
  }
  return block;
};

const literalFieldValues = (document: string, typeName: string, field: string): readonly string[] =>
  [
    ...typeBlock(document, typeName).matchAll(new RegExp(`readonly ${field}: '([^']+)'`, 'g')),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

const unionLiterals = (document: string, typeName: string): readonly string[] =>
  [...typeBlock(document, typeName).matchAll(/'([A-Z][A-Z_]+)'/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

const tableRowsAfter = (document: string, marker: string): readonly (readonly string[])[] => {
  const lines = document.split(marker)[1]?.trimStart().split('\n');
  if (lines === undefined || !lines[0]?.startsWith('|')) {
    throw new Error(`Missing table after ${marker}`);
  }
  const end = lines.findIndex((line) => !line.startsWith('|'));
  return lines
    .slice(0, end === -1 ? undefined : end)
    .filter((_, indexInTable) => indexInTable !== 0 && indexInTable !== 1)
    .map((line) =>
      line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim()),
    );
};

describe('Accepted decoder and reducer target', () => {
  test('keeps shipped status, final-manifest ownership, and the executable example synchronized', () => {
    expect(readme).toContain('package-example:start:task-branch-terminal');
    expect(readme).toContain('package-example:end:task-branch-terminal');
    for (const value of [
      'definePipeline',
      'compilePipeline',
      'decodeCompiledPipeline',
      'decidePipeline',
      'reducePipeline',
    ]) {
      expect(readme).toContain(`export declare function ${value}`);
    }
    expect(readme).toContain('Pre-release package. It is not published to npm');
    expect(readme).toContain('no runtime dependencies');
    expect(readme).toContain('Narrow decisions by `kind`');
    expect(modules).toContain('final five-value/92-type root manifest');
    expect(decoder).toContain('## Shipped example and proof');
    expect(reducer).toContain('- Implementation: Shipped by PR7');
    expect(adr).toContain('The shipped public root contains five values and 92 types.');
    for (const stalePhrase of [
      'No such decoder is part of this\nAccepted root manifest',
      'Target for PR7; not currently exported',
      'Until then these are Accepted targets, not shipped exports',
      'This section plans PR6/PR7 ownership without creating files or exports now',
    ]) {
      expect([readme, decoder, reducer, modules, adr].join('\n')).not.toContain(stalePhrase);
    }
  });

  test('pins the exact hostile compiled module inventory and direct-import DAG', () => {
    expect(
      fencedBlockAfter(
        modules,
        'The hostile compiled-integrity boundary MUST have exactly this private module map:',
        'text',
      ),
    ).toBe(compiledIntegrityModuleMap);
    expect(fencedBlockAfter(modules, 'and follow this\ndirect-import DAG:', 'text')).toBe(
      compiledIntegrityDag,
    );
  });

  test('keeps accepted shipped contracts and their ADR', () => {
    for (const document of [decoder, reducer, adr, scriptAdr, definition]) {
      expect(document).toContain('- Status: Accepted');
    }
  });

  test('pins native script lowering and unresolved-template compatibility', () => {
    for (const typeName of [
      'JsonValue',
      'ScriptIdentity',
      'ScriptNode',
      'ExecutorRequirement',
      'TerminalBindingTemplate',
      'PipelineExecutionTemplate',
    ]) {
      expect(definition).toContain(`type ${typeName} =`);
    }
    expect(definition).toContain('readonly template: PipelineExecutionTemplate');
    expect(definition).toContain('MUST lower each valid `ScriptNode` to a `TaskNode`');
    expect(definition).toContain("template's `pipeline` MUST be the identical object");
    expect(scriptAdr).toContain('ADR 0002 continues to own');
    expect(architecture).toContain('Task-only definitions and consumers');
    expect(readme).toContain('does not resolve or execute scripts');
  });

  test('fixes exact callables and excludes convenience/stateful surfaces', () => {
    expect(decoder).toContain('decodeCompiledPipeline(input: unknown): CompiledPipelineDecoding');
    expect(reducer).toContain(
      'reducePipeline(\n  pipeline: CompiledPipeline,\n  snapshot: PipelineSnapshot,\n  command: PipelineCommand,\n): PipelineReduction',
    );
    expect(reducer).toContain('There is no `createPipeline`, standalone `valueFact`');
    expect(reducer).toContain('There is no reducer `quiescent` success');
    expect(reducer).toContain('mutable\nsession');
  });

  test('keeps decoder-and-reducer manifests exact, unique, and equal across owning documents', () => {
    const reducerManifest = manifestAfter(reducer, 'The exact new public type manifest is:');
    const moduleManifest = manifestAfter(
      modules,
      'The exact decoder-and-reducer public type addition manifest is:',
    );
    expect(reducerManifest).toHaveLength(23);
    expect(new Set(reducerManifest).size).toBe(23);
    expect(moduleManifest).toEqual(reducerManifest);
    expect(reducerManifest.slice(0, 3)).toEqual([
      'CompiledPipelineDecoding',
      'DecodeFault',
      'DecodeFaultCode',
    ]);
    expect(reducer).toContain('producing 86 root types');
  });

  test('keeps every public discriminant and fault union exact and unique', () => {
    expect(literalFieldValues(decoder, 'CompiledPipelineDecoding', 'ok')).toEqual([]);
    expect(
      [
        ...typeBlock(decoder, 'CompiledPipelineDecoding').matchAll(/readonly ok: (true|false)/g),
      ].map((match) => match[1]),
    ).toEqual(['true', 'false']);
    expect(literalFieldValues(reducer, 'PipelineSnapshot', 'phase')).toEqual([
      'uninitialized',
      'active',
      'terminal',
    ]);
    expect(literalFieldValues(reducer, 'PipelineCommand', 'kind')).toEqual([
      'init',
      'taskOutcome',
      'consensusVerdict',
      'humanGateResolution',
    ]);
    expect(literalFieldValues(reducer, 'PipelineEffect', 'kind')).toEqual([
      'initialize',
      'completeTask',
      'recordConsensusVerdict',
      'resolveHumanGate',
      'completeSelector',
      'activateNode',
      'terminatePipeline',
    ]);
    expect(literalFieldValues(reducer, 'PipelineValueSource', 'kind')).toEqual([
      'init',
      'taskOutcome',
      'humanGateResolution',
    ]);
    expect(literalFieldValues(reducer, 'PipelineSnapshotNode', 'state')).toEqual([
      'enabled',
      'terminal',
      'retired',
    ]);
    expect(literalFieldValues(reducer, 'PipelineForkRelation', 'kind')).toEqual([
      'none',
      'branch',
      'join',
    ]);
    expect(unionLiterals(decoder, 'DecodeFaultCode')).toEqual([
      'DECODE_TYPE',
      'DECODE_LIMIT',
      'DECODE_SCHEMA',
      'DECODE_REFERENCE',
      'DECODE_GRAPH',
      'DECODE_CANONICAL',
      'DECODE_DIAGNOSTIC_LIMIT',
    ]);
    const reductionFaults = unionLiterals(reducer, 'PipelineReductionFaultCode');
    expect(reductionFaults).toEqual([
      'PIPELINE_TYPE',
      'PIPELINE_LIMIT',
      'PIPELINE_SCHEMA',
      'PIPELINE_REFERENCE',
      'PIPELINE_GRAPH',
      'PIPELINE_CANONICAL',
      'SNAPSHOT_TYPE',
      'SNAPSHOT_LIMIT',
      'SNAPSHOT_SCHEMA',
      'SNAPSHOT_DUPLICATE',
      'SNAPSHOT_FOREIGN',
      'SNAPSHOT_OUTCOME',
      'SNAPSHOT_CANDIDATE',
      'SNAPSHOT_RESOLUTION',
      'SNAPSHOT_PREMATURE',
      'SNAPSHOT_CAUSAL',
      'SNAPSHOT_PHASE',
      'SNAPSHOT_UNSETTLED',
      'COMMAND_TYPE',
      'COMMAND_LIMIT',
      'COMMAND_SCHEMA',
      'COMMAND_DUPLICATE',
      'COMMAND_TARGET',
      'COMMAND_OUTCOME',
      'COMMAND_CONFLICT',
      'COMMAND_STATE',
      'REDUCTION_STEP_LIMIT',
      'REDUCTION_INVARIANT',
      'REDUCTION_DIAGNOSTIC_LIMIT',
    ]);
    expect(new Set(reductionFaults).size).toBe(reductionFaults.length);
  });

  test('locks semantic identity, phase invariants, value rules, and precedence', () => {
    expect(tableRowsAfter(reducer, 'Command identity and replay content are exact:')).toEqual([
      ['`init`', 'snapshot occurrence key', 'complete normalized initial value set'],
      ['`taskOutcome`', 'exact node occurrence', 'outcome plus complete source-owned value set'],
      ['`consensusVerdict`', 'exact consensus occurrence plus candidate', 'complete verdict'],
      [
        '`humanGateResolution`',
        'exact human-gate occurrence',
        'resolution plus complete source-owned value set',
      ],
    ]);
    expect(tableRowsAfter(reducer, 'Snapshot phases have these exact invariants:')).toHaveLength(3);
    expect(
      tableRowsAfter(reducer, 'After replay/conflict lookup, new command lifecycle is exact:'),
    ).toEqual([
      ['`init`', 'N/A; pipeline-level', 'snapshot is `uninitialized`', '`COMMAND_STATE`'],
      [
        '`taskOutcome`',
        'exact compiled `task`',
        'target snapshot node is `enabled`',
        '`COMMAND_STATE` when omitted, retired, terminal, or otherwise not enabled',
      ],
      [
        '`consensusVerdict`',
        'exact compiled `consensus`',
        'target snapshot node is `enabled`',
        '`COMMAND_STATE` when omitted, retired, terminal, or otherwise not enabled',
      ],
      [
        '`humanGateResolution`',
        'exact compiled `humanGate`',
        'target snapshot node is `enabled`',
        '`COMMAND_STATE` when omitted, retired, terminal, or otherwise not enabled',
      ],
    ]);
    expect(reducer).toContain(
      'wrong compiled node kind is `COMMAND_TARGET`. This target/domain failure precedes\nidentity replay/conflict',
    );
    expect(reducer).toContain('A foreign occurrence key is `COMMAND_TARGET` before replay lookup');
    expect(reducer).toContain(
      'Replay/conflict\ntherefore outranks later terminal or retired state',
    );
    expect(reducer).toContain('canonicalized in declared fact order');
    expect(reducer).toContain('`failed`, `cancelled`,\nand `skipped` require `values: []`');
    expect(reducer).toContain('even when its scalar value is equal');
  });

  test('locks exact fact mapping, diagnostic messages, and caps', () => {
    const mapping = tableRowsAfter(
      reducer,
      'The fact-to-snapshot mapping is exact; `SNAPSHOT_SCHEMA` is not a mapped fact fault:',
    );
    expect(mapping).toEqual([
      ['`FACT_TYPE`', '`SNAPSHOT_TYPE`'],
      ['`FACT_LIMIT`', '`SNAPSHOT_LIMIT`'],
      ['`FACT_DUPLICATE`', '`SNAPSHOT_DUPLICATE`'],
      ['`FACT_FOREIGN`', '`SNAPSHOT_FOREIGN`'],
      ['`FACT_OUTCOME`', '`SNAPSHOT_OUTCOME`'],
      ['`FACT_CANDIDATE`', '`SNAPSHOT_CANDIDATE`'],
      ['`FACT_RESOLUTION`', '`SNAPSHOT_RESOLUTION`'],
      ['`FACT_PREMATURE`', '`SNAPSHOT_PREMATURE`'],
      ['`FACT_CAUSAL`', '`SNAPSHOT_CAUSAL`'],
    ]);
    expect(mapping.flat()).not.toContain('`SNAPSHOT_SCHEMA`');
    expect(reducer).toContain("message: 'Pipeline reduction diagnostic limit exceeded.'");
    expect(reducer).toContain("message: 'Pipeline reduction step limit exceeded.'");
    expect(reducer).toContain('Paths are at most 1,024 characters and messages at most 512');
    expect(reducer).toContain('| diagnostics');
    expect(reducer).toContain('| retirements / decision applications / effects');
  });

  test('locks hostile pruning and finite-unrolling migration across boundary documents', () => {
    expect(reducer).toContain('descriptor-first, accessor-free');
    expect(reducer).toContain('failed an earlier stage');
    expect(reducer).toContain('key count MUST equal `length + 1`');
    expect(reducer).toContain('More than 32 reflected keys');
    expect(reducer).toContain('A proxy\ncan execute side effects or fail to terminate');
    for (const document of [reducer, architecture, adr]) {
      expect(document).toMatch(/finite|forward-only/);
      expect(document).toMatch(/unroll/i);
      expect(document).toMatch(/occurrence/i);
    }
    expect(reducer).toContain('entry -> prepare -> developer.1 -> review.1');
    expect(reducer).toContain('final join or gate activates once');
  });

  test('keeps CAS obligations storage-neutral', () => {
    expect(reducer).toContain('On optimistic CAS\nconflict it reloads and recomputes');
    expect(adr).toContain('Consumer-specific\nschemas and transaction technology');
  });
});
