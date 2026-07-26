import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';

const SCRIPT = 'scripts/sonar-issues-local.sh';
const EXPECTED_REVISION = '0123456789abcdef0123456789abcdef01234567';
const CURL_STUB = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$SONAR_STUB_LOG"
if [[ "\${SONAR_STUB_FAIL:-}" == "1" ]]; then
  exit 22
fi
if [[ "$*" == *"/api/project_pull_requests/list"* ]]; then
  printf '%s' "$SONAR_STUB_PULL_REQUESTS"
elif [[ "$*" == *"/api/project_analyses/search"* ]]; then
  printf '%s' "$SONAR_STUB_BRANCH_ANALYSES"
else
  printf '%s' "$SONAR_STUB_ISSUES"
fi
`;

const GH_STUB = `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${SONAR_STUB_GH_PR_NUMBER:-}" ]]; then
  printf '{"number":%s}' "$SONAR_STUB_GH_PR_NUMBER"
  exit 0
fi
exit 1
`;

let stubDirectory = '';
let stubLog = '';

beforeEach(async () => {
  stubDirectory = await mkdtemp(join(tmpdir(), 'revo-pipeline-sonar-'));
  stubLog = join(stubDirectory, 'curl.log');
  const curlPath = join(stubDirectory, 'curl');
  const ghPath = join(stubDirectory, 'gh');
  await writeFile(curlPath, CURL_STUB, 'utf8');
  await writeFile(ghPath, GH_STUB, 'utf8');
  await chmod(curlPath, 0o755);
  await chmod(ghPath, 0o755);
});

afterEach(async () => {
  await rm(stubDirectory, { recursive: true, force: true });
});

const runIssueCheck = (overrides: NodeJS.ProcessEnv = {}) => {
  const inherited = { ...process.env };
  delete inherited['GITHUB_EVENT_NAME'];
  delete inherited['GITHUB_EVENT_PATH'];
  delete inherited['SONAR_BRANCH_NAME'];
  delete inherited['SONAR_PR_KEY'];
  delete inherited['SONAR_TOKEN'];
  const env = {
    ...inherited,
    PATH: `${stubDirectory}:${dirname(process.execPath)}:${process.env['PATH'] ?? ''}`,
    SONAR_ENV_FILE: '/dev/null',
    SONAR_EXPECTED_REVISION: EXPECTED_REVISION,
    SONAR_STUB_BRANCH_ANALYSES: JSON.stringify({
      analyses: [{ revision: EXPECTED_REVISION }],
    }),
    SONAR_STUB_PULL_REQUESTS: JSON.stringify({
      pullRequests: [{ commit: { sha: EXPECTED_REVISION }, key: '42' }],
    }),
    SONAR_STUB_ISSUES: JSON.stringify({ issues: [], total: 0 }),
    SONAR_STUB_LOG: stubLog,
    ...overrides,
  };
  return spawnSync('bash', [SCRIPT], { cwd: process.cwd(), encoding: 'utf8', env });
};

test('fails explicitly when the Sonar token is missing', () => {
  const result = runIssueCheck();

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('SONAR_TOKEN is required');
});

test('fails when authenticated provider access is unavailable', () => {
  const result = runIssueCheck({ SONAR_STUB_FAIL: '1', SONAR_TOKEN: 'test-token' });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Authenticated Sonar analysis query failed');
});

test('selects the exact PR key and accepts its commit revision', async () => {
  const result = runIssueCheck({ SONAR_PR_KEY: '42', SONAR_TOKEN: 'test-token' });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Sonar analysis revision: ${EXPECTED_REVISION}`);
  expect(result.stdout).toContain('Sonar open issues: 0');
  const calls = await readFile(stubLog, 'utf8');
  expect(calls).toContain('/api/project_pull_requests/list');
  expect(calls).not.toContain('/api/project_analyses/search');
  expect(calls).toContain('pullRequest=42');
});

test('selects the exact branch and accepts its latest analysis revision', async () => {
  const result = runIssueCheck({
    SONAR_BRANCH_NAME: 'release/next',
    SONAR_STUB_GH_PR_NUMBER: '8',
    SONAR_TOKEN: 'test-token',
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Sonar analysis revision: ${EXPECTED_REVISION}`);
  const calls = await readFile(stubLog, 'utf8');
  expect(calls).toContain('/api/project_analyses/search');
  expect(calls).not.toContain('/api/project_pull_requests/list');
  expect(calls.match(/branch=release\/next/gu)).toHaveLength(2);
});

test('rejects zero open issues when the expected PR analysis is missing', () => {
  const result = runIssueCheck({
    SONAR_PR_KEY: '42',
    SONAR_STUB_PULL_REQUESTS: JSON.stringify({ pullRequests: [] }),
    SONAR_TOKEN: 'test-token',
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Sonar pull request 42 analysis was not found.');
  expect(result.stdout).not.toContain('Sonar open issues: 0');
});

test('rejects zero open issues when the provider analysis revision does not match', () => {
  const result = runIssueCheck({
    SONAR_PR_KEY: '42',
    SONAR_STUB_PULL_REQUESTS: JSON.stringify({
      pullRequests: [{ commit: { sha: 'stale-revision' }, key: '42' }],
    }),
    SONAR_TOKEN: 'test-token',
  });

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    `Sonar analysis revision mismatch: expected ${EXPECTED_REVISION}, received stale-revision.`,
  );
  expect(result.stdout).not.toContain('Sonar open issues: 0');
});
