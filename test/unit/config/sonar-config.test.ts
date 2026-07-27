import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test } from 'vitest';

const acceptedAliasCriteria = new Map([
  ['acceptedBranchNameAlias', 'src/spec/branch-name.ts'],
  ['acceptedCandidateKeyAlias', 'src/spec/candidate-key.ts'],
  ['acceptedFactKeyAlias', 'src/spec/fact-key.ts'],
  ['acceptedNodeKeyAlias', 'src/spec/node-key.ts'],
  ['acceptedResolutionNameAlias', 'src/spec/resolution-name.ts'],
]);

const acceptedImplementationCriteria = new Map([
  [
    'boundedFactInspection',
    { resourceKey: 'src/policy/inspect-portable-value-set.ts', ruleKey: 'typescript:S3776' },
  ],
]);

const acceptedCriteria = new Map([
  ...[...acceptedAliasCriteria].map(
    ([criterion, resourceKey]) =>
      [criterion, { resourceKey, ruleKey: 'typescript:S6564' }] as const,
  ),
  ...acceptedImplementationCriteria,
]);

const allowedIssueIgnoreKeys = [
  'sonar.issue.ignore.multicriteria',
  ...[...acceptedCriteria.keys()].flatMap((criterion) => [
    `sonar.issue.ignore.multicriteria.${criterion}.resourceKey`,
    `sonar.issue.ignore.multicriteria.${criterion}.ruleKey`,
  ]),
].sort();

const temporarySonarExpiries = {} as const;

const validateTemporarySonarExpiries = (registry: unknown): void => {
  expect(registry).toEqual(temporarySonarExpiries);
};

const readProperties = async (): Promise<Map<string, string>> => {
  const source = await readFile(join(process.cwd(), 'sonar-project.properties'), 'utf8');
  const properties = new Map<string, string>();
  for (const line of source.split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator > 0 && !line.startsWith('#')) {
      properties.set(line.slice(0, separator), line.slice(separator + 1));
    }
  }
  return properties;
};

test('limits Sonar exceptions to reviewed semantic and implementation cases', async () => {
  const properties = await readProperties();
  const criteria = properties.get('sonar.issue.ignore.multicriteria')?.split(',');
  const issueIgnoreKeys = [...properties.keys()]
    .filter((key) => key.startsWith('sonar.issue.ignore.'))
    .sort();

  expect(issueIgnoreKeys).toEqual(allowedIssueIgnoreKeys);
  expect(criteria).toEqual([...acceptedCriteria.keys()]);
  expect(
    criteria?.map((criterion) => ({
      criterion,
      resourceKey: properties.get(`sonar.issue.ignore.multicriteria.${criterion}.resourceKey`),
      ruleKey: properties.get(`sonar.issue.ignore.multicriteria.${criterion}.ruleKey`),
    })),
  ).toEqual(
    [...acceptedCriteria].map(([criterion, accepted]) => ({
      criterion,
      ...accepted,
    })),
  );
  for (const { resourceKey, ruleKey } of acceptedCriteria.values()) {
    expect(resourceKey).toMatch(/^src\/[^*?{},[\]]+\.ts$/u);
    expect(resourceKey).not.toMatch(/(?:^|\/)\.\.(?:\/|$)/u);
    expect(ruleKey).toMatch(/^typescript:S[0-9]+$/u);
  }
  expect(properties.get('sonar.exclusions')).toBeUndefined();
  expect(properties.get('sonar.coverage.exclusions')).toBeUndefined();
  expect(properties.get('sonar.cpd.exclusions')).toBeUndefined();
  expect(properties.get('sonar.issue.ignore.allfile')).toBeUndefined();
  expect(properties.get('sonar.issue.ignore.block')).toBeUndefined();
  expect(properties.get('sonar.sources')).toBe('src');
  expect(properties.get('sonar.tests')).toBe('test');
  expect(properties.get('sonar.test.inclusions')).toBe('test/**/*.ts');
});

test('locks temporary Sonar criteria to their exact removal owners', async () => {
  const registry = JSON.parse(
    await readFile(
      join(process.cwd(), 'scripts/architecture/temporary-sonar-expiries.json'),
      'utf8',
    ),
  ) as unknown;
  if (typeof registry !== 'object' || registry === null) {
    throw new TypeError('Temporary Sonar expiry registry must be an object.');
  }

  validateTemporarySonarExpiries(registry);
  expect(Object.keys(registry).sort()).toEqual([]);
});

test('rejects temporary Sonar expiry scope or ownership drift', () => {
  expect(() =>
    validateTemporarySonarExpiries({
      ...temporarySonarExpiries,
      boundedCompiledInspection: {
        resourceKey: 'src/transition/*.ts',
        owner: 'PR4b',
        ruleKey: 'typescript:S3776',
      },
    }),
  ).toThrowError('expected');
  expect(() =>
    validateTemporarySonarExpiries({
      boundedCompiledInspection: {
        owner: 'PR4c',
        resourceKey: 'src/transition/decide-pipeline.ts',
        ruleKey: 'typescript:S3776',
      },
    }),
  ).toThrowError('expected');
  expect(() =>
    validateTemporarySonarExpiries({
      boundedCompiledInspection: {
        owner: 'PR4a',
        resourceKey: 'src/transition/compiled/validate-compiled-internally.ts',
        ruleKey: 'typescript:S3776',
      },
    }),
  ).toThrowError('expected');
});

test('makes the CI Sonar provider gate explicit for PR and branch analysis', async () => {
  const workflow = await readFile(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

  expect(workflow).not.toMatch(/jobs:\n[\s\S]*?\n    env:\n[\s\S]*?SONAR_TOKEN:/u);
  expect(workflow).toContain(
    "ref: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}",
  );
  expect(workflow).toMatch(
    /- name: Require Sonar provider access\n\s+env:\n\s+SONAR_TOKEN: \$\{\{ secrets\.SONAR_TOKEN \}\}\n\s+run: \|[\s\S]*?exit 1/u,
  );
  expect(workflow.match(/-Dsonar\.qualitygate\.wait=true/gu)).toHaveLength(2);
  expect(workflow.match(/-Dsonar\.qualitygate\.timeout=300/gu)).toHaveLength(2);
  expect(workflow).toContain('-Dsonar.branch.name=${{ github.ref_name }}');
  expect(workflow).toContain('-Dsonar.scm.revision=${{ github.sha }}');
  expect(workflow).toContain('-Dsonar.pullrequest.key=${{ github.event.pull_request.number }}');
  expect(workflow).toContain('-Dsonar.scm.revision=${{ github.event.pull_request.head.sha }}');
  expect(workflow).toMatch(
    /- name: Inspect Sonar open issues\n\s+env:[\s\S]*?SONAR_EXPECTED_REVISION:[\s\S]*?SONAR_TOKEN: \$\{\{ secrets\.SONAR_TOKEN \}\}\n\s+run: pnpm sonar:issues:local/u,
  );
});
