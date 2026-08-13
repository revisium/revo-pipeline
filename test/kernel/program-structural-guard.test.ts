import { describe, expect, it } from 'vitest';

import {
  analyzeProgram,
  type ProgramMapNode,
  type ProgramNodeId,
} from '../../src/program/index.js';
import { kernelModule, kernelProgram, kernelRegion } from '../support/kernel-builders.js';
import { inspectKernelProgram } from '../support/kernel-internal.js';
import { programEnd, programNodeExamples } from '../support/program-builders.js';

const digestFromNumber = (value: number): ProgramNodeId =>
  `sha256:${value.toString(16).padStart(64, '0')}`;

const mapExample = (): ProgramMapNode => {
  const example = programNodeExamples().find((node): node is ProgramMapNode => node.kind === 'map');
  if (example === undefined) {
    throw new TypeError('Expected a map fixture.');
  }
  return example;
};

describe('kernel Program structural guard', () => {
  it.each([
    ['empty map concurrency', 0, 2],
    ['non-empty map concurrency', 2, 3],
  ] as const)('rejects %s above max(1, maximumItems)', (_name, maximumItems, concurrency) => {
    const map = { ...mapExample(), maximumItems, maximumConcurrency: concurrency };
    const bundle = kernelProgram([
      kernelModule('main', kernelRegion([map, programEnd()], { entry: map.id })),
    ]);
    expect(inspectKernelProgram(bundle).ok).toBe(false);
  });

  it('rejects duplicate node IDs in one region and counts both structural visits', () => {
    const duplicateId = digestFromNumber(70_000);
    const nodes = [
      programEnd(duplicateId),
      { ...programEnd(duplicateId), outcome: 'other' },
    ] as const;
    const bundle = kernelProgram([
      kernelModule(
        'main',
        kernelRegion(nodes, { id: digestFromNumber(70_010), outcomes: ['ok', 'other'] }),
      ),
    ]);
    expect(analyzeProgram(bundle.program).analysis.structure.nodes).toBe(2);
    expect(inspectKernelProgram(bundle).ok).toBe(false);
  });

  it('rejects duplicate node IDs between a parent and nested region', () => {
    const duplicateId = digestFromNumber(71_000);
    const example = mapExample();
    const map = {
      ...example,
      body: {
        ...example.body,
        id: digestFromNumber(71_010),
        entry: duplicateId,
        nodes: [programEnd(duplicateId)] as const,
      },
    };
    const bundle = kernelProgram([
      kernelModule(
        'main',
        kernelRegion([map, programEnd(duplicateId)], {
          id: digestFromNumber(71_020),
          entry: map.id,
        }),
      ),
    ]);
    expect(analyzeProgram(bundle.program).analysis.structure.nodes).toBe(3);
    expect(inspectKernelProgram(bundle).ok).toBe(false);
  });

  it('rejects duplicate node IDs across sibling modules', () => {
    const duplicateId = digestFromNumber(72_000);
    const bundle = kernelProgram(
      [
        kernelModule(
          'a',
          kernelRegion([programEnd(duplicateId)], { id: digestFromNumber(72_010) }),
        ),
        kernelModule(
          'b',
          kernelRegion([programEnd(duplicateId)], { id: digestFromNumber(72_020) }),
        ),
      ],
      'a',
    );
    expect(analyzeProgram(bundle.program).analysis.structure.nodes).toBe(2);
    expect(inspectKernelProgram(bundle).ok).toBe(false);
  });
});
