import { describe, expect, it } from 'vitest';

import { compilePipeline } from '../../src/compiler/index.js';
import type { ProgramParallelNode } from '../../src/program/index.js';
import {
  consensusAgentNode,
  consensusSelection,
  materializationFor,
} from '../support/compiler-builders.js';
import { inspectKernelProgram } from '../support/kernel-internal.js';
import { sourceForNode } from '../support/source-builders.js';

const mapNonEmpty = <Value>(
  values: readonly [Value, ...Value[]],
  change: (value: Value) => Value,
): [Value, ...Value[]] => {
  const [first, ...rest] = values;
  return [change(first), ...rest.map(change)];
};

const compiledVoteProgram = () => {
  const source = sourceForNode(consensusAgentNode());
  const result = compilePipeline(source, materializationFor(source, consensusSelection()));
  if (!result.ok) {
    throw new TypeError('Expected the compiler-emitted vote Program.');
  }
  return { program: result.program, programDigest: result.programDigest };
};

const replaceVote = (
  change: (node: Extract<ProgramParallelNode, { readonly mode: 'votes' }>) => ProgramParallelNode,
) => {
  const bundle = compiledVoteProgram();
  const module = bundle.program.modules[0];
  const vote = module.region.nodes.find(
    (node) => node.kind === 'parallel' && node.mode === 'votes',
  );
  if (vote?.kind !== 'parallel' || vote.mode !== 'votes') {
    throw new TypeError('Expected a vote node.');
  }
  return {
    programDigest: bundle.programDigest,
    program: {
      ...bundle.program,
      modules: [
        {
          ...module,
          region: {
            ...module.region,
            nodes: module.region.nodes.map((node) => (node.id === vote.id ? change(vote) : node)),
          },
        },
      ],
    },
  };
};

const replaceFirstBranch = (
  node: Extract<ProgramParallelNode, { readonly mode: 'votes' }>,
  change: (branch: (typeof node.branches)[number]) => (typeof node.branches)[number],
): ProgramParallelNode => {
  const [first, ...rest] = node.branches;
  return { ...node, branches: [change(first), ...rest] };
};

describe('kernel vote Program admission', () => {
  it('accepts the compiler-emitted participant topology', () => {
    expect(inspectKernelProgram(compiledVoteProgram()).ok).toBe(true);
  });

  it.each([
    [
      'branch identity input',
      replaceVote((node) =>
        replaceFirstBranch(node, (branch) => ({
          ...branch,
          input: { unexpected: { kind: 'literal', value: 1 } },
        })),
      ),
    ],
    [
      'participant requirement',
      replaceVote((node) =>
        replaceFirstBranch(node, (branch) => ({
          ...branch,
          region: {
            ...branch.region,
            nodes: mapNonEmpty(branch.region.nodes, (child) =>
              child.kind === 'activity' ? { ...child, requirementKey: 'other' } : child,
            ),
          },
        })),
      ),
    ],
    [
      'participant output schema',
      replaceVote((node) =>
        replaceFirstBranch(node, (branch) => ({
          ...branch,
          region: {
            ...branch.region,
            outputSchema: {
              type: 'object',
              properties: {},
              required: [],
              additionalProperties: false,
            },
          },
        })),
      ),
    ],
    [
      'participant exit schema',
      replaceVote((node) =>
        replaceFirstBranch(node, (branch) => ({
          ...branch,
          region: {
            ...branch.region,
            exits: mapNonEmpty(branch.region.exits, (exit) =>
              exit.outcome === 'vote' ? { ...exit, outputSchema: { type: 'null' as const } } : exit,
            ),
          },
        })),
      ),
    ],
    [
      'participant end mapping',
      replaceVote((node) =>
        replaceFirstBranch(node, (branch) => ({
          ...branch,
          region: {
            ...branch.region,
            nodes: mapNonEmpty(branch.region.nodes, (child) =>
              child.kind === 'end' && child.outcome === 'vote' ? { ...child, output: {} } : child,
            ),
          },
        })),
      ),
    ],
  ] as const)('rejects a malformed %s', (_name, bundle) => {
    expect(inspectKernelProgram(bundle).ok).toBe(false);
  });
});
