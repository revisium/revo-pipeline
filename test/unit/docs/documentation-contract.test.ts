import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

const rootUrl = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, rootUrl), 'utf8');

const readme = read('README.md');
const api = read('docs/api.md');
const stateMachine = read('docs/state-machine.md');
const hostIntegration = read('docs/host-integration.md');
const forkJoinScenario = read('docs/examples/fork-join-consensus-terminal.md');
const humanGateScenario = read('docs/examples/human-gate-terminal-replay.md');

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown, name: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
};

const stringField = (owner: Readonly<Record<string, unknown>>, key: string): string => {
  const value = owner[key];
  if (typeof value !== 'string') {
    throw new Error(`package.json ${key} must be a string.`);
  }
  return value;
};

const parsedPackageJson: unknown = JSON.parse(read('package.json'));
const packageJsonRecord = record(parsedPackageJson, 'package.json');
const packageJson = {
  name: stringField(packageJsonRecord, 'name'),
  version: stringField(packageJsonRecord, 'version'),
  license: stringField(packageJsonRecord, 'license'),
  type: stringField(packageJsonRecord, 'type'),
  sideEffects: packageJsonRecord['sideEffects'],
  main: stringField(packageJsonRecord, 'main'),
  types: stringField(packageJsonRecord, 'types'),
  dependencies:
    packageJsonRecord['dependencies'] === undefined
      ? {}
      : record(packageJsonRecord['dependencies'], 'package.json dependencies'),
  nodeEngine: stringField(record(packageJsonRecord['engines'], 'package.json engines'), 'node'),
  exports: record(packageJsonRecord['exports'], 'package.json exports'),
};

const compact = (document: string): string => document.replace(/\s+/g, ' ');

type DocumentationTarget = {
  readonly topic: string;
  readonly path: string;
};

const DOCUMENTATION_TARGETS = [
  { topic: 'Documentation index', path: 'docs/README.md' },
  { topic: 'API reference', path: 'docs/api.md' },
  { topic: 'State machine, facts, and decisions', path: 'docs/state-machine.md' },
  { topic: 'Host integration and CAS', path: 'docs/host-integration.md' },
  { topic: 'Scenario index', path: 'docs/examples/README.md' },
  {
    topic: 'Fork/join/consensus scenario',
    path: 'docs/examples/fork-join-consensus-terminal.md',
  },
  {
    topic: 'Human-gate/replay scenario',
    path: 'docs/examples/human-gate-terminal-replay.md',
  },
  { topic: 'Definition specification', path: 'docs/specs/pipeline-definition-v1.spec.md' },
  {
    topic: 'Transition specification',
    path: 'docs/specs/pipeline-transition-v1.spec.md',
  },
  { topic: 'Decoding specification', path: 'docs/specs/pipeline-decoding-v1.spec.md' },
  { topic: 'Reducer specification', path: 'docs/specs/pipeline-reducer-v1.spec.md' },
  { topic: 'Package-boundary ADR', path: 'docs/adr/0001-package-boundary.md' },
  {
    topic: 'Decoder/reducer ADR',
    path: 'docs/adr/0002-portable-decoding-and-reduction.md',
  },
  { topic: 'Architecture', path: 'docs/architecture.md' },
  { topic: 'Testing', path: 'docs/testing.md' },
  { topic: 'Transition traceability', path: 'docs/transition-test-traceability.md' },
] as const satisfies readonly DocumentationTarget[];

type DocumentationRow = {
  readonly topic: string;
  readonly versionPath: string;
  readonly currentPath: string;
};

const tableBody = (document: string, heading: string): string => {
  const afterHeading = document.split(heading);
  if (afterHeading.length !== 2) {
    throw new Error(`Expected exactly one ${heading} table.`);
  }
  const table = afterHeading[1]?.match(/^\n\|[- |]+\|\n((?:\|.*\|\n)+)/)?.[1];
  if (table === undefined) {
    throw new Error(`Malformed ${heading} table.`);
  }
  return table.trim();
};

const cells = (line: string): readonly string[] =>
  line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());

const linkPath = (link: string, label: string, ref: string): string => {
  const escapedRef = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = link.match(
    new RegExp(
      `^\\[${label}\\]\\(https://github\\.com/revisium/revo-pipeline/blob/${escapedRef}/(.+)\\)$`,
    ),
  );
  if (match?.[1] === undefined) {
    throw new Error(`Invalid ${label} link.`);
  }
  return match[1];
};

const documentationRows = (document: string): readonly DocumentationRow[] => {
  const heading =
    '| Topic                               | Version 0.0.0 documentation (immutable release target)                                                            | Current development documentation (mutable)                                                                       |';
  const rows = tableBody(document, heading).split('\n').map(cells);
  if (rows.some((row) => row.length !== 3)) {
    throw new Error('Documentation rows must contain exactly three cells.');
  }
  return rows.map(([topic = '', versionLink = '', currentLink = '']) => ({
    topic,
    versionPath: linkPath(versionLink, 'version', 'v0.0.0'),
    currentPath: linkPath(currentLink, 'current', 'master'),
  }));
};

const validateDocumentationTable = (document: string): readonly DocumentationRow[] => {
  const rows = documentationRows(document);
  const actual = rows.map(({ topic, versionPath, currentPath }) => ({
    topic,
    path: versionPath === currentPath ? versionPath : '<mismatch>',
  }));
  if (
    rows.length !== DOCUMENTATION_TARGETS.length ||
    new Set(rows.map(({ topic }) => topic)).size !== rows.length ||
    JSON.stringify(actual) !== JSON.stringify(DOCUMENTATION_TARGETS)
  ) {
    throw new Error('Documentation table does not match the exact target manifest.');
  }
  return rows;
};

const API_VALUES = [
  'definePipeline',
  'compilePipeline',
  'decodeCompiledPipeline',
  'decidePipeline',
  'reducePipeline',
] as const;

const apiValues = (document: string): readonly string[] => {
  const heading =
    '| Value                    | Use                                                                                                                                           |';
  return tableBody(document, heading)
    .split('\n')
    .map(cells)
    .map(([value = '']) => {
      const match = value.match(/^`([^`]+)`$/);
      if (match?.[1] === undefined) {
        throw new Error('Malformed public API value.');
      }
      return match[1];
    });
};

describe('Consumer documentation contract', () => {
  test('keeps badges and package claims synchronized with package.json', () => {
    expect(readme.match(/^\[!\[.*$/gm)).toEqual([
      '[![CI](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/revisium/revo-pipeline/actions/workflows/ci.yml)',
      '[![Sonar quality gate](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)',
      '[![Sonar coverage](https://sonarcloud.io/api/project_badges/measure?project=revisium_revo-pipeline&metric=coverage)](https://sonarcloud.io/summary/new_code?id=revisium_revo-pipeline)',
      `[![${packageJson.license} license](https://img.shields.io/badge/license-${packageJson.license}-blue.svg)](./LICENSE)`,
    ]);
    expect(readme).toContain(`# ${packageJson.name}`);
    expect(readme).toContain(
      `This repository artifact implements \`${packageJson.name}\` version \`${packageJson.version}\`.`,
    );
    expect(readme).toContain(`The package requires Node.js \`${packageJson.nodeEngine}\`.`);
    expect(packageJson.type).toBe('module');
    expect(packageJson.sideEffects).toBe(false);
    expect(packageJson.main).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(Object.keys(packageJson.exports)).toEqual(['.']);
    expect(Object.keys(packageJson.dependencies)).toEqual([]);
    expect(compact(readme)).toContain(
      'It is strict ESM, has one named-export root, bundles TypeScript declarations, has zero runtime dependencies',
    );
  });

  test('discovers exactly the five public API values', () => {
    expect(apiValues(readme)).toEqual(API_VALUES);
  });

  test('pins the exact immutable/current documentation link manifest and rejects drift', () => {
    const rows = validateDocumentationTable(readme);
    for (const { currentPath } of rows) {
      expect(existsSync(new URL(currentPath, rootUrl))).toBe(true);
    }

    const firstRow = readme.split('\n').find((line) => line.startsWith('| Documentation index '));
    if (firstRow === undefined) {
      throw new Error('Missing documentation index row.');
    }
    const mutants = [
      readme.replace('/blob/v0.0.0/docs/README.md', '/blob/v0.0.1/docs/README.md'),
      readme.replace('/blob/master/docs/README.md', '/blob/main/docs/README.md'),
      readme.replace('/blob/master/docs/README.md', '/blob/HEAD/docs/README.md'),
      readme.replace(
        '[current](https://github.com/revisium/revo-pipeline/blob/master/docs/README.md)',
        '[current](./docs/README.md)',
      ),
      readme.replace('/blob/v0.0.0/docs/README.md', '/blob/docs/README.md'),
      readme.replace(
        'github.com/revisium/revo-pipeline/blob/v0.0.0/docs/README.md',
        'mirror.example/revisium/revo-pipeline/blob/v0.0.0/docs/README.md',
      ),
      readme.replace(`${firstRow}\n`, ''),
      readme.replace(
        `${firstRow}\n`,
        `${firstRow}\n| Unexpected | [version](https://github.com/revisium/revo-pipeline/blob/v0.0.0/docs/api.md) | [current](https://github.com/revisium/revo-pipeline/blob/master/docs/api.md) |\n`,
      ),
      readme.replace(`${firstRow}\n`, `${firstRow}\n${firstRow}\n`),
      readme.replace(
        tableBody(
          readme,
          '| Topic                               | Version 0.0.0 documentation (immutable release target)                                                            | Current development documentation (mutable)                                                                       |',
        ),
        firstRow,
      ),
    ];
    for (const mutant of mutants) {
      expect(() => validateDocumentationTable(mutant)).toThrow(
        /Invalid (?:version|current) link|exact target manifest/,
      );
    }

    expect(readme).toContain('Registry publication is a separate authorized release operation');
    expect(compact(readme)).toContain('may be unavailable before the tag is created');
    expect(compact(readme)).toContain(
      'After the exact version has been independently confirmed in the registry, install it with:',
    );
  });

  test('defines the portable compiled, facts, decision, and reduction boundaries', () => {
    expect(api).toContain(
      '`CompiledPipeline` is the package-owned, JSON-compatible canonical representation',
    );
    expect(api).toContain(
      '`ok`; success is a new deeply frozen `CompiledPipeline` and failure is bounded',
    );
    expect(api).not.toContain('success is a new deeply frozen snapshot');
    expect(api).toContain('contains no run state, host objects, callbacks, clocks, IDs');
    expect(stateMachine).toContain('`PipelineFacts` is one complete point-in-time host projection');
    expect(stateMachine).toContain('one pipeline-global namespace');
    expect(stateMachine).toContain('There is no node-local namespace.');
    expect(stateMachine).toContain('`values` is complete');
    expect(stateMachine).toContain('`JsonScalar` is `null | boolean | number | string`');
    expect(stateMachine).toContain(
      '`JoinArrival` is not a public type or fact; join readiness is derived',
    );
    expect(
      [readme, api, stateMachine, hostIntegration, forkJoinScenario, humanGateScenario]
        .join('\n')
        .match(/JoinArrival/g),
    ).toHaveLength(1);
  });

  test('requires aborting failed decode or reduction and complete guarded CAS replay', () => {
    for (const failure of ['if decoding fails:', 'if reduction fails:']) {
      const section = hostIntegration.split(failure)[1]?.split(/\n  [a-z]/)[0] ?? '';
      expect(section).toContain('perform no authoritative transition write or revision advance');
      expect(section).toContain('abort/roll back this transition attempt');
    }
    for (const required of [
      'serialized compiled bytes/identity and schema version',
      'snapshot phase, values, node occurrences and',
      'candidate verdicts, gate resolutions, and terminal state',
      'every command authorization input and accepted external value',
      'exactly represent the returned next snapshot and whole ordered',
      'discard decoded pipeline, projection, command, reduction, batch, mapping',
      'reload, decode, reproject, reauthorize, reconstruct, reduce, and remap',
    ]) {
      expect(compact(hostIntegration)).toContain(required);
    }
    expect(compact(hostIntegration)).toContain(
      'separately initiated, authorized, concurrency-guarded host action using freshly loaded data',
    );
  });

  test('keeps human-gate acceptance host-owned and portable resolution package-owned', () => {
    for (const required of [
      'authenticates, authorizes, and accepts external input',
      'Identity, eligibility, inbox presentation, durable answer/audit storage',
      'concurrent submission CAS',
      'portable shape, bounds, occurrence, target kind',
      'declared resolution/value domains',
      'replay/conflict',
    ]) {
      expect(compact(hostIntegration)).toContain(required);
    }
    expect(humanGateScenario).toContain("kind: 'humanGateResolution'");
    expect(humanGateScenario).toContain("replay.application, 'unchanged'");
    expect(humanGateScenario).toContain('assert.deepEqual(replayCommand, replayCommandBefore)');
  });

  test('keeps host frameworks, persistence models, and execution machinery out', () => {
    const detailedConsumerDocs = [api, stateMachine, hostIntegration].join('\n');
    for (const forbidden of [
      'Prisma',
      'DBOS',
      'NestJS',
      'RunManager',
      'RunNodeInstance',
      'availableAt',
      'heartbeat',
    ]) {
      expect(detailedConsumerDocs).not.toContain(forbidden);
    }
  });
});
