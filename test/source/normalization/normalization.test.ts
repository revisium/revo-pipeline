import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { compareUnicodeCodePoints } from '../../../src/foundation/index.js';
import type { PipelineSourcePackage, SourceNode } from '../../../src/source/index.js';
import {
  agentSource,
  endNode,
  nonEmptyNodes,
  sourceNodeBuilders,
  sourceWithNodes,
} from '../../support/source-builders.js';
import { expectValidSource } from '../../support/source-validation.js';

describe('source normalization', () => {
  it('sorts the final reachable-agent index by canonical sourcePath', () => {
    const example = sourceNodeBuilders.agent();
    const agents: SourceNode[] = Array.from({ length: 11 }, (_, index) => {
      const target = index === 10 ? 'done' : `a${String(index + 1).padStart(2, '0')}`;
      return {
        ...example,
        key: `a${String(index).padStart(2, '0')}`,
        slotKey: `slot-${String(index).padStart(2, '0')}`,
        strategies: [
          {
            kind: 'single',
            routes: { succeeded: target, failed: target, cancelled: target },
          },
        ],
      };
    });
    const normalized = expectValidSource(sourceWithNodes(nonEmptyNodes([...agents, endNode()])));
    const paths = normalized.reachableAgents.map(({ sourcePath }) => sourcePath);

    expect(paths.indexOf('/modules/0/region/nodes/10')).toBeLessThan(
      paths.indexOf('/modules/0/region/nodes/2'),
    );
    expect(paths).toEqual([...paths].sort(compareUnicodeCodePoints));
  });

  it('pins canonical bytes, path, digest, and input-order independence', async () => {
    const source = agentSource();
    const module = source.modules[0];
    const permuted: PipelineSourcePackage = {
      ...source,
      modules: [
        {
          ...module,
          region: {
            ...module.region,
            nodes: nonEmptyNodes([...module.region.nodes].reverse()),
          },
        },
      ],
    };
    const validated = expectValidSource(source);
    const reordered = expectValidSource(permuted);
    const fixtureUrl = new URL('../../fixtures/source/normalized.json', import.meta.url);
    const expectedText = (await readFile(fixtureUrl, 'utf8')).trim();
    const payload = Buffer.from(expectedText, 'utf8');
    const expectedDigest = `sha256:${createHash('sha256')
      .update(`revo-pipeline-digest-v1\npipeline-source/v1\n${payload.byteLength}\n`, 'utf8')
      .update(payload)
      .digest('hex')}`;

    expect(validated.canonicalText).toBe(expectedText);
    expect(validated.sourceDigest).toBe(expectedDigest);
    expect(validated.sourceDigest).toBe(
      'sha256:ad3e4b93cf9ff93fafa2787dc3973569de625cbda5a8d4d90632ffd558ad5551',
    );
    expect(validated.reachableAgents.map(({ sourcePath }) => sourcePath)).toEqual([
      '/modules/0/region/nodes/0',
    ]);
    expect(reordered.canonicalText).toBe(validated.canonicalText);
    expect(reordered.sourceDigest).toBe(validated.sourceDigest);
  });

  it('normalizes every keyed set before deriving descendant paths', () => {
    const source = agentSource();
    const module = source.modules[0];
    const agent = module.region.nodes[0];
    if (agent?.kind !== 'agent') {
      throw new TypeError('Expected normalized agent node.');
    }
    const normalizedInput: PipelineSourcePackage = {
      ...source,
      modules: [
        {
          ...module,
          region: {
            ...module.region,
            nodes: [
              {
                ...agent,
                strategies: [
                  {
                    kind: 'consensus',
                    minimumParticipants: 2,
                    maximumParticipants: 3,
                    policy: { kind: 'unanimous' },
                    remaining: 'drain',
                    routes: {
                      approved: 'done',
                      rejected: 'done',
                      inconclusive: 'done',
                      participantFailed: 'done',
                      cancelled: 'done',
                    },
                  },
                  ...agent.strategies,
                ],
              },
              ...module.region.nodes.slice(1),
            ],
          },
        },
      ],
    };
    const validated = expectValidSource(normalizedInput);

    expect(validated.source.modules[0]?.region.nodes.map(({ key }) => key)).toEqual(['a', 'done']);
    const normalizedAgent = validated.source.modules[0]?.region.nodes[0];
    expect(normalizedAgent?.kind).toBe('agent');
    const strategyKinds =
      normalizedAgent?.kind === 'agent' ? normalizedAgent.strategies.map(({ kind }) => kind) : [];
    expect(strategyKinds).toEqual(['consensus', 'single']);
  });

  it('preserves an own __proto__ mapping key on an ordinary frozen record', () => {
    const script = sourceNodeBuilders.script();
    const properties = Object.fromEntries([['__proto__', { type: 'string' as const }]]);
    const source = sourceWithNodes(
      nonEmptyNodes([
        {
          ...script,
          input: Object.fromEntries([['__proto__', { kind: 'literal' as const, value: 'safe' }]]),
          inputSchema: {
            type: 'object',
            properties,
            required: ['__proto__'],
            additionalProperties: false,
          },
        },
        endNode(),
      ]),
    );
    const normalized = expectValidSource(source);
    const node = normalized.source.modules[0]?.region.nodes[0];
    if (node?.kind !== 'script') {
      throw new TypeError('Expected a normalized script node.');
    }
    expect(Object.getPrototypeOf(node.input)).toBe(Object.prototype);
    expect(Object.hasOwn(node.input, '__proto__')).toBe(true);
    expect(node.input.__proto__).toEqual({ kind: 'literal', value: 'safe' });
    expect(Object.isFrozen(node.input)).toBe(true);
  });
});
