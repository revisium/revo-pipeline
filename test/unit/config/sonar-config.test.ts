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
  expect(properties.get('sonar.exclusions')).toBe(
    'dist/**,coverage/**,node_modules/**,**/generated/**,**/fixtures/**',
  );
  expect(properties.get('sonar.coverage.exclusions')).toBe('test/**,scripts/**');
  expect(properties.get('sonar.cpd.exclusions')).toBe('test/**,**/generated/**,**/fixtures/**');
});
