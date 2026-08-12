import { describe, expect, it } from 'vitest';

import type { ProgramNode } from '../../src/program/index.js';
import { kernelModule, kernelProgram, kernelRegion } from '../support/kernel-builders.js';
import { inspectKernelProgram } from '../support/kernel-internal.js';
import { programEnd, programId, programNodeExamples } from '../support/program-builders.js';

const withNode = (node: ProgramNode) => {
  const end = programEnd();
  const main = kernelModule('main', kernelRegion(node.kind === 'end' ? [node] : [node, end]));
  return node.kind === 'call'
    ? kernelProgram(
        [kernelModule('child', kernelRegion([end], { id: programId('e') })), main],
        'main',
      )
    : kernelProgram([main]);
};

const invalidPrograms = (): readonly (readonly [string, unknown])[] => {
  const end = programEnd();
  const valid = kernelProgram([kernelModule('main', kernelRegion([end]))]);
  const activity = programNodeExamples()[0];
  const call = programNodeExamples()[2];
  const gate = programNodeExamples()[7];
  if (activity?.kind !== 'activity' || call?.kind !== 'call' || gate?.kind !== 'humanGate') {
    throw new TypeError('Expected canonical Program examples.');
  }
  const secondModule = kernelModule('other', kernelRegion([end], { id: programId('d') }));
  const twoModules = kernelProgram([valid.program.modules[0], secondModule]);
  const region = valid.program.modules[0].region;
  return [
    [
      'non-envelope',
      new Proxy(
        {},
        {
          ownKeys: () => {
            throw new Error('opaque');
          },
        },
      ),
    ],
    ['schema', {}],
    [
      'module order',
      {
        ...twoModules,
        program: { ...twoModules.program, modules: twoModules.program.modules.toReversed() },
      },
    ],
    ['entry module', { ...valid, program: { ...valid.program, entryModule: 'missing' } }],
    [
      'duplicate module',
      {
        ...twoModules,
        program: {
          ...twoModules.program,
          modules: twoModules.program.modules.map((module) => ({ ...module, key: 'main' })),
        },
      },
    ],
    [
      'duplicate region',
      {
        ...twoModules,
        program: {
          ...twoModules.program,
          modules: twoModules.program.modules.map((module) => ({
            ...module,
            region: { ...module.region, id: region.id },
          })),
        },
      },
    ],
    [
      'node order',
      {
        ...valid,
        program: {
          ...valid.program,
          modules: [
            {
              ...valid.program.modules[0],
              region: { ...region, entry: activity.id, nodes: [end, activity] },
            },
          ],
        },
      },
    ],
    [
      'exit order',
      {
        ...valid,
        program: {
          ...valid.program,
          modules: [
            {
              ...valid.program.modules[0],
              region: {
                ...region,
                exits: [
                  { ...region.exits[0], outcome: 'z' },
                  { ...region.exits[0], outcome: 'a' },
                ],
              },
            },
          ],
        },
      },
    ],
    [
      'region entry',
      {
        ...valid,
        program: {
          ...valid.program,
          modules: [{ ...valid.program.modules[0], region: { ...region, entry: programId('e') } }],
        },
      },
    ],
    [
      'local route',
      withNode({
        ...activity,
        routes: { ...activity.routes, succeeded: programId('e') },
      }),
    ],
    [
      'linked module',
      kernelProgram([kernelModule('main', kernelRegion([{ ...call, module: 'missing' }, end]))]),
    ],
    ['region exit', withNode({ ...end, outcome: 'missing' })],
    [
      'gate answers',
      withNode({
        ...gate,
        answers: ['no'],
      }),
    ],
  ];
};

describe('kernel Program admission', () => {
  it.each(programNodeExamples().map((node) => [node.kind, node] as const))(
    'indexes a valid %s node without executing RP05 behavior',
    (_kind, node) => {
      expect(inspectKernelProgram(withNode(node)).ok).toBe(true);
    },
  );

  it.each(invalidPrograms())('rejects the %s semantic violation', (_name, input) => {
    expect(inspectKernelProgram(input).ok).toBe(false);
  });
});
