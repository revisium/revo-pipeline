import { describe, expect, it } from 'vitest';

import { actionableSonarIssues } from '../../scripts/sonar-issue-status.mjs';

describe('Sonar issue status inspection', () => {
  it('ignores stale closed rows while retaining actionable rows', () => {
    const open = { key: 'open', status: 'OPEN', issueStatus: 'OPEN' };
    const confirmed = { key: 'confirmed', status: 'CONFIRMED' };

    expect(
      actionableSonarIssues({
        issues: [
          { key: 'closed', status: 'CLOSED' },
          { key: 'fixed', status: 'CLOSED', resolution: 'FIXED', issueStatus: 'FIXED' },
          { key: 'accepted', status: 'ACCEPTED' },
          { key: 'accepted-current', status: 'RESOLVED', issueStatus: 'ACCEPTED' },
          { key: 'false-positive', status: 'FALSE_POSITIVE' },
          open,
          confirmed,
        ],
      }),
    ).toEqual([open, confirmed]);
  });

  it('fails closed for malformed or missing issue lists', () => {
    expect(() => actionableSonarIssues(null)).toThrow(TypeError);
    expect(() => actionableSonarIssues({})).toThrow(TypeError);
  });

  it.each([
    null,
    [],
    {},
    { status: 1 },
    { issueStatus: [] },
    { issueStatus: 'FUTURE_UNKNOWN' },
    { status: 'CLOSED', issueStatus: null },
    { status: 'OPEN', issueStatus: null },
    { status: 'OPEN', issueStatus: undefined },
  ])('fails closed for an invalid issue row %#', (issue) => {
    expect(() => actionableSonarIssues({ issues: [issue] })).toThrow(TypeError);
  });
});
