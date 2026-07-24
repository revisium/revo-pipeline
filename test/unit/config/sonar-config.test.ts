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

const allowedIssueIgnoreKeys = [
  'sonar.issue.ignore.multicriteria',
  ...[...acceptedAliasCriteria.keys()].flatMap((criterion) => [
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

test('limits the S6564 exception to the accepted semantic public aliases', async () => {
  const properties = await readProperties();
  const criteria = properties.get('sonar.issue.ignore.multicriteria')?.split(',');
  const issueIgnoreKeys = [...properties.keys()]
    .filter((key) => key.startsWith('sonar.issue.ignore.'))
    .sort();

  expect(issueIgnoreKeys).toEqual(allowedIssueIgnoreKeys);
  expect(criteria).toEqual([...acceptedAliasCriteria.keys()]);
  expect(
    criteria?.map((criterion) => ({
      resourceKey: properties.get(`sonar.issue.ignore.multicriteria.${criterion}.resourceKey`),
      ruleKey: properties.get(`sonar.issue.ignore.multicriteria.${criterion}.ruleKey`),
    })),
  ).toEqual(
    [...acceptedAliasCriteria.values()].map((resourceKey) => ({
      resourceKey,
      ruleKey: 'typescript:S6564',
    })),
  );
  expect(properties.get('sonar.exclusions')).toBe(
    'dist/**,coverage/**,node_modules/**,**/generated/**,**/fixtures/**',
  );
  expect(properties.get('sonar.coverage.exclusions')).toBe('test/**,scripts/**');
  expect(properties.get('sonar.cpd.exclusions')).toBe('test/**,**/generated/**,**/fixtures/**');
});
