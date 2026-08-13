import { describe, expect, it } from 'vitest';

import { PipelineFailureValueSchema, type ValueSchema } from '../../src/foundation/index.js';
import type { KernelProgram } from '../../src/kernel/index.js';
import {
  type ProgramModule,
  type ProgramNode,
  type ProgramNodeId,
  type ProgramRegion,
} from '../../src/program/index.js';
import { kernelModule, kernelProgram, kernelRegion } from '../support/kernel-builders.js';
import { inspectKernelProgram } from '../support/kernel-internal.js';
import { programEnd, programId, programNodeExamples } from '../support/program-builders.js';
import { emptySchema } from '../support/source-builders.js';

const digestFromNumber = (value: number): ProgramNodeId =>
  `sha256:${value.toString(16).padStart(64, '0')}`;

const nonEmpty = <Value>(values: readonly Value[]): readonly [Value, ...Value[]] => {
  const [first, ...remaining] = values;
  if (first === undefined) {
    throw new TypeError('Expected a non-empty fixture collection.');
  }
  return [first, ...remaining];
};

const callNode = (
  module: string,
  nodeId: ProgramNodeId,
  target: ProgramNodeId,
): Extract<ProgramNode, { readonly kind: 'call' }> => ({
  kind: 'call',
  id: nodeId,
  module,
  input: {},
  outputSchema: emptySchema(),
  routes: { outcomes: [{ outcome: 'ok', target }], failed: target, cancelled: target },
});

const callDepthProgram = (depth: number): KernelProgram => {
  const modules: ProgramModule[] = [];
  for (let ordinal = 0; ordinal <= depth; ordinal += 1) {
    const nodeId = digestFromNumber(10_000 + ordinal * 2);
    const end = programEnd(digestFromNumber(10_001 + ordinal * 2));
    const node =
      ordinal === depth
        ? end
        : callNode(`module-${String(ordinal + 1).padStart(2, '0')}`, nodeId, end.id);
    modules.push(
      kernelModule(
        `module-${String(ordinal).padStart(2, '0')}`,
        kernelRegion(node === end ? [end] : [node, end], {
          id: digestFromNumber(20_000 + ordinal),
        }),
      ),
    );
  }
  return kernelProgram(nonEmpty(modules), 'module-00');
};

const nestedRegion = (depth: number): ProgramRegion => {
  let region = kernelRegion([programEnd(digestFromNumber(30_000 + depth * 3))], {
    id: digestFromNumber(40_000 + depth),
  });
  for (let ordinal = depth - 1; ordinal >= 0; ordinal -= 1) {
    const end = programEnd(digestFromNumber(30_001 + ordinal * 3));
    const repeat: ProgramNode = {
      kind: 'repeat',
      id: digestFromNumber(30_000 + ordinal * 3),
      maximumIterations: 1,
      initialInput: {},
      nextInput: {},
      body: region,
      bodyExits: [{ outcome: 'ok', classification: 'value' }],
      continueWhen: { kind: 'exists', selector: { kind: 'literal', value: true } },
      output: {},
      outputSchema: emptySchema(),
      routes: { completed: end.id, exhausted: end.id, failed: end.id, cancelled: end.id },
    };
    region = kernelRegion([repeat, end], { id: digestFromNumber(40_000 + ordinal) });
  }
  return region;
};

const cyclicRegion = (indirect: boolean): ProgramRegion => {
  const firstId = programId('1');
  const secondId = programId('2');
  const first: ProgramNode = {
    kind: 'choice',
    id: firstId,
    selector: { kind: 'literal', value: true },
    cases: [
      { key: 'yes', when: { kind: 'equals', value: true }, target: indirect ? secondId : firstId },
    ],
    otherwise: indirect ? secondId : firstId,
  };
  if (!indirect) {
    return kernelRegion([first]);
  }
  const second: ProgramNode = {
    ...first,
    id: secondId,
    cases: [{ ...first.cases[0], target: firstId }],
    otherwise: firstId,
  };
  return kernelRegion([first, second]);
};

const callOutcomeProgram = (outcomes: readonly string[]): KernelProgram => {
  const childEnds: readonly [ProgramNode, ProgramNode] = [
    { ...programEnd(digestFromNumber(50_000)), outcome: 'a' },
    { ...programEnd(digestFromNumber(50_001)), outcome: 'b' },
  ];
  const child = kernelModule(
    'child',
    kernelRegion(childEnds, { id: digestFromNumber(50_010), outcomes: ['a', 'b'] }),
  );
  const end = programEnd(digestFromNumber(50_020));
  const call: ProgramNode = {
    ...callNode('child', digestFromNumber(50_021), end.id),
    kind: 'call',
    routes: {
      outcomes: nonEmpty(outcomes.map((outcome) => ({ outcome, target: end.id }))),
      failed: end.id,
      cancelled: end.id,
    },
  };
  return kernelProgram([child, kernelModule('main', kernelRegion([call, end]))], 'main');
};

const parallelWithClassifications = (
  childOutcomes: readonly string[],
  classifications: readonly {
    readonly outcome: string;
    readonly classification: 'qualifies' | 'failed';
  }[],
  failedSchema: ValueSchema = emptySchema(),
): KernelProgram => {
  const parallel = programNodeExamples().find(
    (node): node is Extract<ProgramNode, { kind: 'parallel'; mode: 'generic' }> =>
      node.kind === 'parallel' && node.mode === 'generic',
  );
  if (parallel === undefined) {
    throw new TypeError('Expected generic parallel fixture.');
  }
  const childEnds = nonEmpty(
    childOutcomes.map((outcome, index) => ({
      ...programEnd(digestFromNumber(60_000 + index)),
      outcome,
    })),
  );
  const child = kernelRegion(childEnds, {
    id: digestFromNumber(60_010),
    outcomes: childOutcomes,
    outputSchema: failedSchema,
  });
  const [first, second] = parallel.branches;
  const node: ProgramNode = {
    ...parallel,
    branches: [
      {
        ...first,
        region: child,
        exits: nonEmpty(classifications),
      },
      { ...second, region: { ...second.region, id: digestFromNumber(60_020) } },
    ],
  };
  return kernelProgram([
    kernelModule('main', kernelRegion([node, programEnd()], { id: digestFromNumber(60_030) })),
  ]);
};

describe('kernel Program semantic guard', () => {
  it.each([
    ['direct CFG cycle', kernelProgram([kernelModule('main', cyclicRegion(false))])],
    ['indirect CFG cycle', kernelProgram([kernelModule('main', cyclicRegion(true))])],
    [
      'direct call recursion',
      kernelProgram([
        kernelModule(
          'main',
          kernelRegion([callNode('main', programId('1'), programId('9')), programEnd()]),
        ),
      ]),
    ],
    [
      'indirect call recursion',
      kernelProgram(
        [
          kernelModule(
            'a',
            kernelRegion([callNode('b', programId('1'), programId('9')), programEnd()], {
              id: programId('a'),
            }),
          ),
          kernelModule(
            'b',
            kernelRegion([callNode('a', programId('2'), programId('9')), programEnd()], {
              id: programId('b'),
            }),
          ),
        ],
        'a',
      ),
    ],
  ] as const)('rejects %s', (_name, bundle) => {
    expect(inspectKernelProgram(bundle).ok).toBe(false);
  });

  it('accepts exact depth 32 and rejects depth 33 for calls and structured regions', () => {
    expect(inspectKernelProgram(callDepthProgram(32)).ok).toBe(true);
    expect(inspectKernelProgram(callDepthProgram(33)).ok).toBe(false);
    expect(inspectKernelProgram(kernelProgram([kernelModule('main', nestedRegion(32))])).ok).toBe(
      true,
    );
    expect(inspectKernelProgram(kernelProgram([kernelModule('main', nestedRegion(33))])).ok).toBe(
      false,
    );
  });

  it.each([
    ['missing', ['a']],
    ['extra', ['a', 'b', 'c']],
    ['missing and extra', ['a', 'c']],
  ] as const)('rejects %s call outcomes', (_name, outcomes) => {
    expect(inspectKernelProgram(callOutcomeProgram(outcomes)).ok).toBe(false);
  });

  it.each([
    ['missing', ['a', 'b'], [{ outcome: 'a', classification: 'qualifies' }] as const],
    [
      'extra',
      ['a', 'b'],
      [
        { outcome: 'a', classification: 'qualifies' },
        { outcome: 'b', classification: 'qualifies' },
        { outcome: 'c', classification: 'qualifies' },
      ] as const,
    ],
    [
      'missing and extra',
      ['a', 'b'],
      [
        { outcome: 'a', classification: 'qualifies' },
        { outcome: 'c', classification: 'qualifies' },
      ] as const,
    ],
  ] as const)('rejects %s structured exit classifications', (_name, outcomes, classifications) => {
    expect(inspectKernelProgram(parallelWithClassifications(outcomes, classifications)).ok).toBe(
      false,
    );
  });

  it('accepts only the exact failure schema for a failed-classified exit', () => {
    const classifications = [{ outcome: 'failed', classification: 'failed' }] as const;
    expect(
      inspectKernelProgram(
        parallelWithClassifications(['failed'], classifications, PipelineFailureValueSchema),
      ).ok,
    ).toBe(true);
    expect(inspectKernelProgram(parallelWithClassifications(['failed'], classifications)).ok).toBe(
      false,
    );
  });

  it('requires module top-region input and output schema equality', () => {
    const region = kernelRegion([programEnd()]);
    const different = { type: 'null' as const };
    expect(inspectKernelProgram(kernelProgram([kernelModule('main', region, different)])).ok).toBe(
      false,
    );
    expect(
      inspectKernelProgram(
        kernelProgram([kernelModule('main', region, region.inputSchema, different)]),
      ).ok,
    ).toBe(false);
  });
});
