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
  [
    'coreDecisionStateMachine',
    { resourceKey: 'src/transition/decide-pipeline.ts', ruleKey: 'typescript:S3776' },
  ],
  [
    'boundedCompiledInspection',
    { resourceKey: 'src/transition/validate-compiled-pipeline.ts', ruleKey: 'typescript:S3776' },
  ],
  [
    'coreDecisionMembership',
    { resourceKey: 'src/transition/decide-pipeline.ts', ruleKey: 'typescript:S7765' },
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
      resourceKey: properties.get(`sonar.issue.ignore.multicriteria.${criterion}.resourceKey`),
      ruleKey: properties.get(`sonar.issue.ignore.multicriteria.${criterion}.ruleKey`),
    })),
  ).toEqual([...acceptedCriteria.values()]);
  expect(properties.get('sonar.exclusions')).toBe(undefined);
  expect(properties.get('sonar.coverage.exclusions')).toBe(undefined);
  expect(properties.get('sonar.cpd.exclusions')).toBe(undefined);
  expect(properties.get('sonar.sources')).toBe('src');
  expect(properties.get('sonar.tests')).toBe('test');
  expect(properties.get('sonar.test.inclusions')).toBe('test/**/*.ts');
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
