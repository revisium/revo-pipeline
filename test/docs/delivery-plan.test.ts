import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type TraceabilityRecord = {
  readonly requirement_id: string;
  readonly spec: string;
  readonly section: string;
  readonly group: string;
  readonly owner: string;
  readonly item: string;
  readonly suite: string;
  readonly evidence_state: string;
};

const traceabilityFields = [
  'requirement_id',
  'spec',
  'section',
  'group',
  'owner',
  'item',
  'suite',
  'evidence_state',
];
const specifications = [
  'pipeline-canonicalization-v1',
  'pipeline-conformance-v1',
  'pipeline-machine-v1',
  'pipeline-materialization-v1',
  'pipeline-program-v1',
  'pipeline-source-v1',
];
const groups = new Set([
  'lifecycle',
  'canonicalization',
  'conformance',
  'machine',
  'materialization',
  'program',
  'source',
]);
const owners = new Set([
  'repository',
  'foundation',
  'source',
  'materialization',
  'program',
  'compiler',
  'kernel',
  'extensions',
]);
const items = new Set(Array.from({ length: 7 }, (_, index) => `rp-0${index}`));
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const deliveryPlan = readFileSync(join(repositoryRoot, 'docs', 'delivery-plan.md'), 'utf8');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseTraceability = (): readonly TraceabilityRecord[] => {
  const json = /## Parseable specification traceability[\s\S]*?```json\n([\s\S]*?)\n```/u.exec(
    deliveryPlan,
  )?.[1];
  if (json === undefined) {
    throw new Error('Missing delivery-plan traceability JSON.');
  }
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) {
    throw new Error('Traceability JSON must be an array.');
  }
  return value.map((row: unknown) => {
    if (!isRecord(row) || JSON.stringify(Object.keys(row)) !== JSON.stringify(traceabilityFields)) {
      throw new Error('Traceability row has an unexpected shape.');
    }
    const { requirement_id, spec, section, group, owner, item, suite, evidence_state } = row;
    if (
      typeof requirement_id !== 'string' ||
      typeof spec !== 'string' ||
      typeof section !== 'string' ||
      typeof group !== 'string' ||
      typeof owner !== 'string' ||
      typeof item !== 'string' ||
      typeof suite !== 'string' ||
      typeof evidence_state !== 'string'
    ) {
      throw new Error('Traceability row fields must be strings.');
    }
    return { requirement_id, spec, section, group, owner, item, suite, evidence_state };
  });
};

const isActiveSuiteReference = (suite: string): boolean => {
  const [path, marker, ...extra] = suite.split('#');
  if (path === undefined || extra.length !== 0 || !/^test\/.+\.test\.ts$/u.test(path)) {
    return false;
  }
  const absolutePath = join(repositoryRoot, path);
  return (
    existsSync(absolutePath) &&
    (marker === undefined ||
      (marker.length > 0 && readFileSync(absolutePath, 'utf8').includes(marker)))
  );
};

describe('delivery plan', () => {
  it.each([...items])('defines complete planning fields for %s', (item) => {
    const section = new RegExp('## `' + item + '`[\\s\\S]*?(?=\\n## |$)', 'u').exec(
      deliveryPlan,
    )?.[0];
    expect(section).toBeDefined();
    for (const field of ['Objective', 'Scope', 'Out of scope', 'Acceptance', 'Dependencies']) {
      expect(section).toContain(`- **${field}:**`);
    }
  });

  it('keeps traceability rows structural, unique, and linked to available evidence', () => {
    const records = parseTraceability();
    expect(records).toHaveLength(62);
    expect(new Set(records.map(({ requirement_id }) => requirement_id)).size).toBe(62);
    expect(records.every(({ requirement_id }) => /^req-\d{3}$/u.test(requirement_id))).toBe(true);
    expect(records.every(({ spec }) => specifications.includes(spec))).toBe(true);
    expect(records.every(({ group }) => groups.has(group))).toBe(true);
    expect(records.every(({ owner }) => owners.has(owner))).toBe(true);
    expect(records.every(({ item }) => items.has(item))).toBe(true);
    expect(new Set(records.map(({ suite }) => suite)).size).toBe(records.length);
    expect(
      records.every(({ evidence_state, item }) =>
        item === 'rp-00' || item === 'rp-01'
          ? evidence_state === 'active'
          : evidence_state === 'planned',
      ),
    ).toBe(true);
    expect(
      records
        .filter(({ evidence_state }) => evidence_state === 'active')
        .every(({ suite }) => isActiveSuiteReference(suite)),
    ).toBe(true);
    expect(
      records
        .filter(({ evidence_state }) => evidence_state === 'planned')
        .every(({ suite }) => /^[a-z][a-z0-9-]+$/u.test(suite)),
    ).toBe(true);
  });

  it('covers every specification section without duplicating a section oracle', () => {
    const sections = specifications.flatMap((specification) => {
      const source = readFileSync(
        join(repositoryRoot, 'docs', 'specs', `${specification}.spec.md`),
        'utf8',
      );
      return [...source.matchAll(/^## (.+)$/gmu)].map(
        (match) => `${specification}:${match[1] ?? ''}`,
      );
    });
    const covered = new Set(parseTraceability().map(({ spec, section }) => `${spec}:${section}`));

    expect(sections).toHaveLength(48);
    expect([...covered].toSorted()).toEqual(sections.toSorted());
  });

  it('preserves the ownership partition structurally', () => {
    const rows = readFileSync(
      join(repositoryRoot, 'docs', 'conformance', 'revo-run-intent-ownership.md'),
      'utf8',
    )
      .split('\n')
      .filter((line) => /^\| rr-\d{3} /u.test(line))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((field) => field.trim()),
      );
    const ids = rows.map(([id]) => id);
    const ownerCounts = Object.groupBy(rows, (row) => row[2] ?? 'missing');

    expect(rows).toHaveLength(103);
    expect(new Set(ids).size).toBe(103);
    expect(
      Object.fromEntries(
        Object.entries(ownerCounts).map(([owner, owned]) => [owner, owned?.length ?? 0]),
      ),
    ).toEqual({
      compiler: 22,
      kernel: 32,
      core: 7,
      run: 42,
    });
  });
});
