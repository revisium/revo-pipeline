import { describe, expect, test } from 'vitest';

import { compilePipeline } from '../../../src/definition/index.js';
import { inspectPortableValue, PIPELINE_LIMITS } from '../../../src/policy/index.js';
import type { PipelineDefinition, PipelineNode } from '../../../src/spec/index.js';

const terminal = { kind: 'terminal', key: 'finish', outcome: 'done' } as const;
const routes = (to: string) => ({
  cancelled: to,
  completed: to,
  failed: to,
  skipped: to,
});
const codes = (definition: PipelineDefinition): readonly string[] => {
  const result = compilePipeline(definition);
  return result.ok ? [] : result.faults.map(({ code }) => code);
};

describe('exact compiler bounds', () => {
  test('enforces portable depth, own-key and visit bounds independently', () => {
    const nested = (depth: number): unknown => (depth === 0 ? null : { child: nested(depth - 1) });
    expect(inspectPortableValue(nested(8)).ok).toBe(true);
    expect(inspectPortableValue(nested(9))).toEqual({
      ok: false,
      issue: { code: 'depth', path: '/child/child/child/child/child/child/child/child/child' },
    });
    expect(
      inspectPortableValue(
        Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`k${index}`, null])),
      ).ok,
    ).toBe(true);
    expect(
      inspectPortableValue(
        Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`k${index}`, null])),
      ),
    ).toEqual({
      ok: false,
      issue: { code: 'object-keys', path: '' },
    });
    expect(
      inspectPortableValue(
        Array.from({ length: 16_383 }, () => null),
        {
          maxArrayLength: 16_384,
        },
      ).ok,
    ).toBe(true);
    expect(
      inspectPortableValue(
        Array.from({ length: 16_384 }, () => null),
        {
          maxArrayLength: 16_384,
        },
      ),
    ).toEqual({
      ok: false,
      issue: { code: 'visited-values', path: '/16383' },
    });
  });

  test('accepts exact name/display bounds and rejects overages', () => {
    const make = (key: string, outcome: string): PipelineDefinition => ({
      schemaVersion: 1,
      entry: key,
      facts: [],
      nodes: [{ kind: 'terminal', key, outcome }],
    });
    expect(
      compilePipeline(
        make(
          'k'.repeat(PIPELINE_LIMITS.portable.nameCodePoints),
          'o'.repeat(PIPELINE_LIMITS.portable.displayCodePoints),
        ),
      ).ok,
    ).toBe(true);
    expect(codes(make('k'.repeat(PIPELINE_LIMITS.portable.nameCodePoints + 1), 'done'))).toContain(
      'DEF_KEY',
    );
    expect(
      codes(make('finish', 'o'.repeat(PIPELINE_LIMITS.portable.displayCodePoints + 1))),
    ).toContain('DEF_TYPE');
  });

  test('accepts 128 facts and rejects 129', () => {
    const make = (length: number): PipelineDefinition => ({
      schemaVersion: 1,
      entry: 'finish',
      facts: Array.from({ length }, (_, index) => ({ key: `fact-${index}`, type: 'string' })),
      nodes: [terminal],
    });
    expect(compilePipeline(make(PIPELINE_LIMITS.definition.declaredFacts)).ok).toBe(true);
    expect(codes(make(PIPELINE_LIMITS.definition.declaredFacts + 1))).toContain('DEF_LIMIT');
  });

  test('accepts 256 nodes and rejects 257', () => {
    const make = (length: number): PipelineDefinition => {
      const nodes: PipelineNode[] = Array.from({ length: length - 1 }, (_, index) => ({
        kind: 'task',
        key: `n-${String(index).padStart(3, '0')}`,
        outcomes: routes(
          index === length - 2 ? 'finish' : `n-${String(index + 1).padStart(3, '0')}`,
        ),
      }));
      nodes.push(terminal);
      return { schemaVersion: 1, entry: 'n-000', facts: [], nodes };
    };
    expect(compilePipeline(make(129)).ok).toBe(true);
    expect(compilePipeline(make(PIPELINE_LIMITS.definition.nodes)).ok).toBe(true);
    expect(codes(make(PIPELINE_LIMITS.definition.nodes + 1))).toContain('DEF_LIMIT');
  });

  test('accepts 64 cases and predicate values and rejects 65', () => {
    const make = (cases: number, values: number): PipelineDefinition => ({
      schemaVersion: 1,
      entry: 'branch',
      facts: [{ key: 'choice', type: 'string' }],
      nodes: [
        {
          kind: 'branch',
          key: 'branch',
          fact: 'choice',
          cases: Array.from({ length: cases }, (_caseEntry, index) => ({
            name: `case-${index}`,
            when: {
              op: 'oneOf',
              values: Array.from(
                { length: values },
                (_predicateEntry, valueIndex) => `${index}-${valueIndex}`,
              ),
            },
            to: 'finish',
          })),
          default: { name: 'default', to: 'finish' },
        },
        terminal,
      ],
    });
    expect(
      compilePipeline(
        make(
          PIPELINE_LIMITS.definition.branchCasesPerNode,
          PIPELINE_LIMITS.definition.predicateValuesPerCase,
        ),
      ).ok,
    ).toBe(true);
    expect(codes(make(PIPELINE_LIMITS.definition.branchCasesPerNode + 1, 1))).toContain(
      'DEF_LIMIT',
    );
    expect(codes(make(1, PIPELINE_LIMITS.definition.predicateValuesPerCase + 1))).toContain(
      'DEF_LIMIT',
    );
  });

  test('accepts 32 fork branches and rejects 33', () => {
    const make = (length: number): PipelineDefinition => ({
      schemaVersion: 1,
      entry: 'fork',
      facts: [],
      nodes: [
        {
          kind: 'fork',
          key: 'fork',
          join: 'join',
          branches: Array.from({ length }, (_, index) => ({
            name: `branch-${index}`,
            entry: `exit-${index}`,
            exit: `exit-${index}`,
          })),
        },
        ...Array.from({ length }, (_, index) => ({
          kind: 'task' as const,
          key: `exit-${index}`,
          outcomes: routes('join'),
        })),
        {
          kind: 'join',
          key: 'join',
          fork: 'fork',
          policy: { kind: 'all' },
          outcomes: { completed: 'finish', insufficient: 'finish', rejected: 'finish' },
        },
        terminal,
      ],
    });
    expect(compilePipeline(make(PIPELINE_LIMITS.definition.forkBranchesPerNode)).ok).toBe(true);
    expect(codes(make(PIPELINE_LIMITS.definition.forkBranchesPerNode + 1))).toContain('DEF_LIMIT');
  });

  test('accepts per-node and total candidate bounds and rejects overages', () => {
    const make = (nodes: number, each: number): PipelineDefinition => ({
      schemaVersion: 1,
      entry: 'consensus-0',
      facts: [],
      nodes: [
        ...Array.from({ length: nodes }, (_nodeEntry, index) => {
          const to = index === nodes - 1 ? 'finish' : `consensus-${index + 1}`;
          return {
            kind: 'consensus' as const,
            key: `consensus-${index}`,
            candidates: Array.from(
              { length: each },
              (_candidateEntry, candidate) => `candidate-${candidate}`,
            ),
            policy: { kind: 'unanimous' as const },
            outcomes: { approved: to, rejected: to, insufficient: to, tied: to },
          };
        }),
        terminal,
      ],
    });
    expect(compilePipeline(make(32, 32)).ok).toBe(true);
    expect(codes(make(1, 33))).toContain('DEF_LIMIT');
    expect(codes(make(33, 32))).toContain('DEF_LIMIT');
  });

  test('accepts exactly 1,024 edges/resolutions and rejects overages', () => {
    const make = (nodes: number, each: number): PipelineDefinition => ({
      schemaVersion: 1,
      entry: 'gate-0',
      facts: [],
      nodes: [
        ...Array.from({ length: nodes }, (_nodeEntry, index) => {
          const to = index === nodes - 1 ? 'finish' : `gate-${index + 1}`;
          return {
            kind: 'humanGate' as const,
            key: `gate-${index}`,
            subject: 'gate',
            resolutions: Array.from({ length: each }, (_resolutionEntry, resolution) => ({
              resolution: `resolution-${resolution}`,
              to,
            })),
          };
        }),
        terminal,
      ],
    });
    expect(compilePipeline(make(32, 32)).ok).toBe(true);
    expect(codes(make(1, 33))).toContain('DEF_LIMIT');
    expect(codes(make(33, 32))).toContain('DEF_LIMIT');
  });

  test('isolates the 1,024/1,025 edge bound below every other total', () => {
    const make = (extraGate: boolean): PipelineDefinition => {
      const gates = Array.from({ length: 31 }, (_entry, index) => {
        const to = index === 30 ? (extraGate ? 'extra-gate' : 'task-0') : `gate-${index + 1}`;
        return {
          kind: 'humanGate' as const,
          key: `gate-${index}`,
          subject: 'gate',
          resolutions: Array.from({ length: 32 }, (_resolution, resolution) => ({
            resolution: `resolution-${resolution}`,
            to,
          })),
        };
      });
      const tasks = Array.from({ length: 8 }, (_entry, index) => ({
        kind: 'task' as const,
        key: `task-${index}`,
        outcomes: routes(index === 7 ? 'finish' : `task-${index + 1}`),
      }));
      return {
        schemaVersion: 1,
        entry: 'gate-0',
        facts: [],
        nodes: [
          ...gates,
          ...(extraGate
            ? [
                {
                  kind: 'humanGate' as const,
                  key: 'extra-gate',
                  subject: 'gate',
                  resolutions: [{ resolution: 'continue', to: 'task-0' }],
                },
              ]
            : []),
          ...tasks,
          terminal,
        ],
      };
    };
    expect(compilePipeline(make(false)).ok).toBe(true);
    const over = compilePipeline(make(true));
    expect(over.ok ? [] : over.faults).toContainEqual(
      expect.objectContaining({ code: 'DEF_LIMIT', message: 'Edge limit exceeded.' }),
    );
  });
});
