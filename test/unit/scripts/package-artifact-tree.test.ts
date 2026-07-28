import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, test } from 'vitest';

import {
  auditPackageArtifactTree,
  assertExactMaterialization,
  cleanupPackageArtifactTree,
  createPackageArtifactTreeForTest,
  destinationPathComponentsForTest,
  inspectTypeClosure,
  materializeTypeClosure,
  prepareExhaustivenessDeclarationForTest,
  restoreExhaustivenessDeclaration,
  runtimeFixturePath,
  writeTreeFile,
  type PackageArtifactTree,
} from '../../../scripts/package/package-artifact-tree.js';
import { planTypeClosure } from '../../../scripts/package/package-type-closure.js';

const writeExtractedPackage = (tree: PackageArtifactTree): void => {
  mkdirSync(join(tree.installedPackageRoot, 'dist'), { recursive: true });
  writeFileSync(
    join(tree.installedPackageRoot, 'package.json'),
    JSON.stringify({
      name: '@revisium/revo-pipeline',
      type: 'module',
      exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
    }),
  );
  writeFileSync(join(tree.installedPackageRoot, 'dist/index.js'), 'export {};\n');
  writeFileSync(join(tree.installedPackageRoot, 'dist/index.d.ts'), 'export {};\n');
};

const treeEntries = (root: string): readonly string[] =>
  Object.freeze(
    readdirSync(root, { recursive: true })
      .map((entry) => entry.toString())
      .sort((left, right) => left.localeCompare(right)),
  );

const syntheticClosure = (): {
  readonly workspace: string;
  readonly registration: ReturnType<typeof createPackageArtifactTreeForTest>;
  readonly nodeRoot: string;
  readonly middleRoot: string;
  readonly leafRoot: string;
  readonly middleLink: string;
  readonly leafLink: string;
} => {
  const workspace = mkdtempSync(join(tmpdir(), 'package-tree-parent-local-'));
  const store = join(workspace, 'node_modules/.pnpm');
  const nodeRoot = join(store, '@types+node@1.0.0/node_modules/@types/node');
  const middleRoot = join(store, 'middle@1.2.0/node_modules/middle');
  const leafRoot = join(store, 'leaf@0.2.4/node_modules/leaf');
  const writePackage = (
    root: string,
    name: string,
    version: string,
    dependencies: Record<string, string>,
  ): void => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name, version, dependencies }));
    writeFileSync(join(root, 'index.d.ts'), 'export {};\n');
  };
  writePackage(nodeRoot, '@types/node', '1.0.0', { middle: '^1.0.0' });
  writePackage(middleRoot, 'middle', '1.2.0', { leaf: '^0.2.3' });
  writePackage(leafRoot, 'leaf', '0.2.4', {});
  const middleLink = join(store, '@types+node@1.0.0/node_modules/middle');
  const leafLink = join(store, 'middle@1.2.0/node_modules/leaf');
  mkdirSync(join(workspace, 'node_modules/@types'), { recursive: true });
  symlinkSync(nodeRoot, join(workspace, 'node_modules/@types/node'), 'dir');
  symlinkSync(middleRoot, middleLink, 'dir');
  symlinkSync(leafRoot, leafLink, 'dir');
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({ devDependencies: { '@types/node': '1.0.0' } }),
  );
  writeFileSync(
    join(workspace, 'pnpm-lock.yaml'),
    `lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      '@types/node':
        specifier: 1.0.0
        version: 1.0.0
snapshots:
  '@types/node@1.0.0':
    dependencies:
      middle: 1.2.0
  middle@1.2.0:
    dependencies:
      leaf: 0.2.4
  leaf@0.2.4: {}
`,
  );
  return {
    workspace,
    registration: createPackageArtifactTreeForTest(workspace, (path) =>
      rmSync(path, { recursive: true }),
    ),
    nodeRoot,
    middleRoot,
    leafRoot,
    middleLink,
    leafLink,
  };
};

const disposeSyntheticClosure = (fixture: ReturnType<typeof syntheticClosure>): void => {
  cleanupPackageArtifactTree(fixture.registration.owner, fixture.registration.tree);
  rmSync(fixture.workspace, { recursive: true, force: true });
};

test('copies the observed lockfile closure as real files and audits the isolated tree', () => {
  const removals: string[] = [];
  const registration = createPackageArtifactTreeForTest(process.cwd(), (path) => {
    removals.push(path);
    rmSync(path, { recursive: true });
  });
  const { owner, tree } = registration;
  writeExtractedPackage(tree);
  const inspection = inspectTypeClosure(tree);
  const plan = planTypeClosure(inspection);
  expect(plan.map(({ name, version }) => `${name}@${version}`)).toEqual([
    'undici-types@7.18.2',
    '@types/node@24.13.3',
  ]);
  materializeTypeClosure(tree, inspection, plan);
  const entrypoint = writeTreeFile(tree, 'consumer.mjs', 'export {};\n');
  expect(() => auditPackageArtifactTree(tree, entrypoint)).not.toThrow();
  cleanupPackageArtifactTree(owner, tree);
  expect(removals).toHaveLength(1);
});

test('rejects a copied cleanup record before invoking removal', () => {
  let removals = 0;
  const registration = createPackageArtifactTreeForTest(process.cwd(), () => {
    removals += 1;
  });
  const { owner, tree } = registration;
  writeFileSync(join(tree.root, 'sentinel'), 'unchanged');
  const before = readdirSync(tree.root);
  const copy: PackageArtifactTree = { ...tree };
  expect(() => cleanupPackageArtifactTree(owner, copy)).toThrow('[package-cleanup]');
  expect(removals).toBe(0);
  expect(readdirSync(tree.root)).toEqual(before);
  expect(readFileSync(join(tree.root, 'sentinel'), 'utf8')).toBe('unchanged');
  rmSync(join(tree.root, '..'), { recursive: true, force: true });
});

test('rejects canonical redirection and symlink mutation without invoking removal', () => {
  let removals = 0;
  const registration = createPackageArtifactTreeForTest(process.cwd(), () => {
    removals += 1;
  });
  const { owner, tree } = registration;
  const target = join(tree.root, '..');
  writeFileSync(join(tree.root, 'sentinel'), 'unchanged');
  const saved = `${target}-saved`;
  renameSync(target, saved);
  symlinkSync(saved, target, 'dir');
  expect(() => cleanupPackageArtifactTree(owner, tree)).toThrow('[package-cleanup]');
  expect(removals).toBe(0);
  expect(readFileSync(join(saved, 'consumer/sentinel'), 'utf8')).toBe('unchanged');
  rmSync(target, { recursive: true, force: true });
  rmSync(saved, { recursive: true, force: true });
});

test.each([
  ['sibling', (target: string, _workspace: string) => `${target}-sibling`],
  ['workspace', (_target: string, workspace: string) => workspace],
  ['cwd', () => process.cwd()],
  ['filesystem root', () => '/'],
  ['ancestor', (target: string) => dirname(target)],
] as const)(
  'rejects cleanup %s redirection with no side effect or removal call',
  (_label, redirectedTarget) => {
    let removals = 0;
    const registration = createPackageArtifactTreeForTest(process.cwd(), () => {
      removals += 1;
    });
    const { owner, tree } = registration;
    const target = join(tree.root, '..');
    const saved = `${target}-saved`;
    const sibling = `${target}-sibling`;
    try {
      writeFileSync(join(tree.root, 'sentinel'), 'unchanged');
      mkdirSync(sibling, { recursive: true });
      renameSync(target, saved);
      symlinkSync(redirectedTarget(target, tree.workspaceRoot), target, 'dir');
      expect(() => cleanupPackageArtifactTree(owner, tree)).toThrow('[package-cleanup]');
      expect(removals).toBe(0);
      expect(readFileSync(join(saved, 'consumer/sentinel'), 'utf8')).toBe('unchanged');
    } finally {
      rmSync(target, { recursive: true, force: true });
      rmSync(saved, { recursive: true, force: true });
      rmSync(sibling, { recursive: true, force: true });
    }
  },
);

test('catches a symlink introduced after an earlier successful audit', () => {
  const registration = createPackageArtifactTreeForTest(process.cwd(), (path) =>
    rmSync(path, { recursive: true }),
  );
  const { owner, tree } = registration;
  writeExtractedPackage(tree);
  const entrypoint = writeTreeFile(tree, 'consumer.mjs', 'export {};\n');
  expect(() => auditPackageArtifactTree(tree, entrypoint)).not.toThrow();
  symlinkSync(entrypoint, join(tree.root, 'late-link'));
  expect(() => auditPackageArtifactTree(tree, runtimeFixturePath(tree, 'consumer.mjs'))).toThrow(
    '[package-isolation-symlink]',
  );
  rmSync(join(tree.root, 'late-link'));
  cleanupPackageArtifactTree(owner, tree);
});

test('rejects a dangling destination file link before any sibling copy', () => {
  const fixture = syntheticClosure();
  const outside = join(fixture.workspace, 'outside-file');
  try {
    const nodeModules = join(fixture.registration.tree.root, 'node_modules');
    const destinationRoot = join(nodeModules, 'leaf');
    mkdirSync(destinationRoot, { recursive: true });
    writeFileSync(join(fixture.leafRoot, 'first.d.ts'), 'export {};\n');
    symlinkSync(outside, join(destinationRoot, 'index.d.ts'), 'file');
    const before = treeEntries(nodeModules);
    const inspection = inspectTypeClosure(fixture.registration.tree);
    expect(() =>
      materializeTypeClosure(fixture.registration.tree, inspection, planTypeClosure(inspection)),
    ).toThrow('[package-isolation-symlink]');
    expect(existsSync(outside)).toBe(false);
    expect(treeEntries(nodeModules)).toEqual(before);
    expect(existsSync(join(destinationRoot, 'first.d.ts'))).toBe(false);
  } finally {
    disposeSyntheticClosure(fixture);
  }
});

test('splits destination components with the supplied platform separator', () => {
  expect(destinationPathComponentsForTest('node_modules\\@scope\\package', '\\')).toEqual([
    'node_modules',
    '@scope',
    'package',
  ]);
});

test('restores exact declaration bytes and rejects reused or foreign handles', () => {
  const first = createPackageArtifactTreeForTest(process.cwd(), (path) =>
    rmSync(path, { recursive: true, force: true }),
  );
  const second = createPackageArtifactTreeForTest(process.cwd(), (path) =>
    rmSync(path, { recursive: true, force: true }),
  );
  const path = join(first.tree.installedPackageRoot, 'dist/errors/pipeline-decision.d.ts');
  mkdirSync(dirname(path), { recursive: true });
  const original = Buffer.from('export type Decision = Alpha | RejectDecision;\\n');
  writeFileSync(path, original);
  const operations = {
    read: (target: string) => readFileSync(target),
    write: (target: string, content: Buffer) => writeFileSync(target, content),
  };
  const prepared = prepareExhaustivenessDeclarationForTest(
    first.tree,
    'decision-growth',
    operations,
  );
  expect(readFileSync(path).equals(original)).toBe(false);
  expect(() => restoreExhaustivenessDeclaration(second.tree, prepared)).toThrow(
    '[package-artifact-identity]',
  );
  restoreExhaustivenessDeclaration(first.tree, prepared);
  expect(readFileSync(path).equals(original)).toBe(true);
  expect(() => restoreExhaustivenessDeclaration(first.tree, prepared)).toThrow(
    '[package-artifact-identity]',
  );
  cleanupPackageArtifactTree(first.owner, first.tree);
  cleanupPackageArtifactTree(second.owner, second.tree);
});

test('restores a partial preparation write and preserves primary-before-restore ordering', () => {
  const registration = createPackageArtifactTreeForTest(process.cwd(), (path) =>
    rmSync(path, { recursive: true, force: true }),
  );
  const path = join(registration.tree.installedPackageRoot, 'dist/errors/pipeline-decision.d.ts');
  mkdirSync(dirname(path), { recursive: true });
  const original = Buffer.from('export type Decision = Alpha | RejectDecision;\\n');
  writeFileSync(path, original);
  let writes = 0;
  const partial = {
    read: (target: string) => readFileSync(target),
    write: (target: string, content: Buffer) => {
      writes += 1;
      if (writes === 1) {
        writeFileSync(target, content.subarray(0, 4));
        throw new Error('prepare-write');
      }
      writeFileSync(target, content);
    },
  };
  expect(() =>
    prepareExhaustivenessDeclarationForTest(registration.tree, 'decision-growth', partial),
  ).toThrow('prepare-write');
  expect(readFileSync(path).equals(original)).toBe(true);

  writes = 0;
  const both = {
    read: partial.read,
    write: (target: string, content: Buffer) => {
      writes += 1;
      if (writes === 1) {
        writeFileSync(target, content.subarray(0, 4));
        throw new Error('prepare-write');
      }
      throw new Error('restore-write');
    },
  };
  let failure: unknown;
  try {
    prepareExhaustivenessDeclarationForTest(registration.tree, 'decision-growth', both);
  } catch (error: unknown) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError)) {
    throw new Error('expected aggregate failure');
  }
  expect(failure.errors.map(String)).toEqual(['Error: prepare-write', 'Error: restore-write']);
  cleanupPackageArtifactTree(registration.owner, registration.tree);
});

test('fails initial-read and absent-sentinel partitions before any declaration write', () => {
  const initialReadFailure = new Error('initial declaration read failed');
  for (const scenario of [
    {
      kind: 'decision-growth' as const,
      read: () => {
        throw initialReadFailure;
      },
      expected: initialReadFailure,
    },
    {
      kind: 'decision-growth' as const,
      read: () => Buffer.from('export type Decision = Alpha;'),
      expected: '[package-artifact-boundary]',
    },
    {
      kind: 'reduction-growth' as const,
      read: () => Buffer.from('export type Reduction = { status: string };'),
      expected: '[package-artifact-boundary]',
    },
  ]) {
    const registration = createPackageArtifactTreeForTest(process.cwd(), (path) =>
      rmSync(path, { recursive: true, force: true }),
    );
    let writes = 0;
    let failure: unknown;
    try {
      prepareExhaustivenessDeclarationForTest(registration.tree, scenario.kind, {
        read: scenario.read,
        write: () => {
          writes += 1;
        },
      });
    } catch (error: unknown) {
      failure = error;
    }
    const expectedMessage =
      scenario.expected instanceof Error ? scenario.expected.message : scenario.expected;
    expect(failure).toBeInstanceOf(Error);
    expect(failure instanceof Error ? failure.message : undefined).toBe(expectedMessage);
    expect(failure === scenario.expected).toBe(scenario.expected instanceof Error);
    expect(writes).toBe(0);
    cleanupPackageArtifactTree(registration.owner, registration.tree);
  }
});

test('detects mutation and restore verification mismatches', () => {
  const registration = createPackageArtifactTreeForTest(process.cwd(), (path) =>
    rmSync(path, { recursive: true, force: true }),
  );
  const path = join(registration.tree.installedPackageRoot, 'dist/errors/pipeline-reduction.d.ts');
  mkdirSync(dirname(path), { recursive: true });
  const original = Buffer.from('export type Reduction = ({}) | { fallback: true };\\n');
  writeFileSync(path, original);
  let reads = 0;
  const mismatch = {
    read: (target: string) => {
      reads += 1;
      return reads === 2 ? Buffer.from('tampered') : readFileSync(target);
    },
    write: (target: string, content: Buffer) => writeFileSync(target, content),
  };
  expect(() =>
    prepareExhaustivenessDeclarationForTest(registration.tree, 'reduction-growth', mismatch),
  ).toThrow('[package-artifact-boundary]');
  expect(readFileSync(path).equals(original)).toBe(true);

  const prepared = prepareExhaustivenessDeclarationForTest(registration.tree, 'reduction-growth', {
    read: (target) => readFileSync(target),
    write: (target, content) => writeFileSync(target, content),
  });
  writeFileSync(path, 'externally changed');
  restoreExhaustivenessDeclaration(registration.tree, prepared);
  expect(readFileSync(path).equals(original)).toBe(true);

  let writes = 0;
  const restoreMismatch = prepareExhaustivenessDeclarationForTest(
    registration.tree,
    'reduction-growth',
    {
      read: (target) => readFileSync(target),
      write: (target, content) => {
        writes += 1;
        if (writes === 1) {
          writeFileSync(target, content);
        }
      },
    },
  );
  expect(() => restoreExhaustivenessDeclaration(registration.tree, restoreMismatch)).toThrow(
    '[package-typescript-restore]',
  );
  expect(() => restoreExhaustivenessDeclaration(registration.tree, restoreMismatch)).toThrow(
    '[package-artifact-identity]',
  );
  cleanupPackageArtifactTree(registration.owner, registration.tree);
});

test.each([
  ['root child', 'root-link', 'file'],
  ['nested package file', 'node_modules/@revisium/revo-pipeline/dist/nested-link', 'file'],
  ['nested type entry', 'node_modules/@types/node/nested-link', 'file'],
  ['nested transitive type entry', 'node_modules/undici-types/nested-link', 'file'],
  ['directory link', 'directory-link', 'dir'],
  ['broken link', 'broken-link', 'file'],
] as const)('rejects an isolated %s symlink before launch', (_label, relativePath, type) => {
  const registration = createPackageArtifactTreeForTest(process.cwd(), (path) =>
    rmSync(path, { recursive: true }),
  );
  const { owner, tree } = registration;
  try {
    writeExtractedPackage(tree);
    mkdirSync(join(tree.root, 'node_modules/@types/node'), { recursive: true });
    mkdirSync(join(tree.root, 'node_modules/undici-types'), { recursive: true });
    const entrypoint = writeTreeFile(tree, 'consumer.mjs', 'export {};\n');
    const link = join(tree.root, relativePath);
    mkdirSync(join(link, '..'), { recursive: true });
    symlinkSync(
      relativePath === 'broken-link' ? join(tree.root, 'missing') : entrypoint,
      link,
      type,
    );
    expect(() => auditPackageArtifactTree(tree, entrypoint)).toThrow('[package-isolation-symlink]');
  } finally {
    cleanupPackageArtifactTree(owner, tree);
  }
});

test('rejects escaped scoped destinations and extra or missing copied packages', () => {
  const registration = createPackageArtifactTreeForTest(process.cwd(), (path) =>
    rmSync(path, { recursive: true }),
  );
  const { owner, tree } = registration;
  try {
    writeExtractedPackage(tree);
    const inspection = inspectTypeClosure(tree);
    const plan = planTypeClosure(inspection);
    expect(() =>
      materializeTypeClosure(tree, inspection, [
        ...plan,
        { name: '@scope/../../escape', version: '1.0.0', sourceId: 'escape' },
      ]),
    ).toThrow('[package-artifact-boundary]');
    expect(() => materializeTypeClosure(tree, inspection, [...plan, plan[0]!])).toThrow(
      '[package-artifact-boundary]',
    );
  } finally {
    cleanupPackageArtifactTree(owner, tree);
  }
});

test.each([
  ['top-level unscoped destination', 'leaf'],
  ['scoped-parent destination', '@types'],
  ['scoped package-root destination', '@types/node'],
  ['nested destination directory', 'leaf/nested'],
] as const)('rejects a %s link before any copy', (_label, relativeDestination) => {
  const fixture = syntheticClosure();
  const sentinel = join(fixture.workspace, 'outside-sentinel');
  try {
    const nodeModules = join(fixture.registration.tree.root, 'node_modules');
    mkdirSync(nodeModules, { recursive: true });
    if (relativeDestination === '@types/node') {
      mkdirSync(join(nodeModules, '@types'), { recursive: true });
    }
    if (relativeDestination === 'leaf/nested') {
      mkdirSync(join(fixture.leafRoot, 'nested'), { recursive: true });
      writeFileSync(join(fixture.leafRoot, 'nested/index.d.ts'), 'export {};\n');
      mkdirSync(join(nodeModules, 'leaf'), { recursive: true });
    }
    writeFileSync(sentinel, 'unchanged');
    symlinkSync(fixture.registration.tree.root, join(nodeModules, relativeDestination), 'dir');
    const inspection = inspectTypeClosure(fixture.registration.tree);
    expect(() =>
      materializeTypeClosure(fixture.registration.tree, inspection, planTypeClosure(inspection)),
    ).toThrow('[package-isolation-symlink]');
    expect(readFileSync(sentinel, 'utf8')).toBe('unchanged');
    expect(existsSync(join(nodeModules, 'middle/index.d.ts'))).toBe(false);
  } finally {
    disposeSyntheticClosure(fixture);
  }
});

test('audits real pre-existing extra and removed copied packages on fresh trees', () => {
  const extra = syntheticClosure();
  try {
    const inspection = inspectTypeClosure(extra.registration.tree);
    const plan = planTypeClosure(inspection);
    mkdirSync(join(extra.registration.tree.root, 'node_modules/extra'), { recursive: true });
    expect(() => materializeTypeClosure(extra.registration.tree, inspection, plan)).toThrow(
      '[package-type-closure]',
    );
  } finally {
    disposeSyntheticClosure(extra);
  }

  const missing = syntheticClosure();
  try {
    const inspection = inspectTypeClosure(missing.registration.tree);
    const plan = planTypeClosure(inspection);
    materializeTypeClosure(missing.registration.tree, inspection, plan);
    rmSync(join(missing.registration.tree.root, 'node_modules/leaf'), { recursive: true });
    expect(() => assertExactMaterialization(missing.registration.tree, plan)).toThrow(
      '[package-type-closure]',
    );
  } finally {
    disposeSyntheticClosure(missing);
  }
});

test('rejects a foreign registered owner before invoking removal', () => {
  let firstRemovals = 0;
  const first = createPackageArtifactTreeForTest(process.cwd(), () => {
    firstRemovals += 1;
  });
  const second = createPackageArtifactTreeForTest(process.cwd(), (path) =>
    rmSync(path, { recursive: true }),
  );
  writeFileSync(join(first.tree.root, 'sentinel'), 'unchanged');
  expect(() => cleanupPackageArtifactTree(second.owner, first.tree)).toThrow('[package-cleanup]');
  expect(firstRemovals).toBe(0);
  expect(readFileSync(join(first.tree.root, 'sentinel'), 'utf8')).toBe('unchanged');
  rmSync(join(first.tree.root, '..'), { recursive: true, force: true });
  cleanupPackageArtifactTree(second.owner, second.tree);
});

test('rejects a special socket entry before launch', async () => {
  const registration = createPackageArtifactTreeForTest(process.cwd(), (path) =>
    rmSync(path, { recursive: true }),
  );
  const { owner, tree } = registration;
  writeExtractedPackage(tree);
  const entrypoint = writeTreeFile(tree, 'consumer.mjs', 'export {};\n');
  const socketPath = join(tree.root, 'special.socket');
  const server = createServer();
  try {
    server.listen(socketPath);
    await once(server, 'listening');
    expect(() => auditPackageArtifactTree(tree, entrypoint)).toThrow('[package-isolation-entry]');
  } finally {
    server.close();
    await once(server, 'close');
    cleanupPackageArtifactTree(owner, tree);
  }
});

test.skipIf(process.platform === 'win32')(
  'rejects a FIFO before launch on supported platforms',
  () => {
    const registration = createPackageArtifactTreeForTest(process.cwd(), (path) =>
      rmSync(path, { recursive: true }),
    );
    const { owner, tree } = registration;
    try {
      writeExtractedPackage(tree);
      const entrypoint = writeTreeFile(tree, 'consumer.mjs', 'export {};\n');
      execFileSync('mkfifo', [join(tree.root, 'special.fifo')]);
      expect(() => auditPackageArtifactTree(tree, entrypoint)).toThrow('[package-isolation-entry]');
    } finally {
      cleanupPackageArtifactTree(owner, tree);
    }
  },
);

test('authenticates every parent-local link to its selected virtual-store snapshot', () => {
  const fixture = syntheticClosure();
  try {
    expect(() => inspectTypeClosure(fixture.registration.tree)).not.toThrow();

    const redirected = join(
      fixture.workspace,
      'node_modules/.pnpm/leaf@0.2.4-redirected/node_modules/leaf',
    );
    mkdirSync(redirected, { recursive: true });
    writeFileSync(
      join(redirected, 'package.json'),
      JSON.stringify({ name: 'leaf', version: '0.2.4' }),
    );
    unlinkSync(fixture.leafLink);
    symlinkSync(redirected, fixture.leafLink, 'dir');
    expect(() => inspectTypeClosure(fixture.registration.tree)).toThrow('[package-type-closure]');
  } finally {
    disposeSyntheticClosure(fixture);
  }
});

test.each([
  'missing-parent-link',
  'wrong-manifest-version',
  'unrelated-top-level-link',
  'outside-store-link',
] as const)('rejects %s without using a top-level substitute', (mutation) => {
  const fixture = syntheticClosure();
  try {
    if (mutation === 'missing-parent-link') {
      unlinkSync(fixture.leafLink);
    } else if (mutation === 'wrong-manifest-version') {
      writeFileSync(
        join(fixture.leafRoot, 'package.json'),
        JSON.stringify({ name: 'leaf', version: '0.2.5' }),
      );
    } else if (mutation === 'unrelated-top-level-link') {
      unlinkSync(fixture.leafLink);
      const topLevel = join(fixture.workspace, 'node_modules/leaf');
      symlinkSync(fixture.leafRoot, topLevel, 'dir');
    } else {
      const outside = join(fixture.workspace, 'outside-leaf');
      mkdirSync(outside, { recursive: true });
      writeFileSync(
        join(outside, 'package.json'),
        JSON.stringify({ name: 'leaf', version: '0.2.4' }),
      );
      unlinkSync(fixture.leafLink);
      symlinkSync(outside, fixture.leafLink, 'dir');
    }
    expect(() => inspectTypeClosure(fixture.registration.tree)).toThrow(
      mutation === 'outside-store-link' ? '[package-artifact-boundary]' : '[package-type-closure]',
    );
  } finally {
    disposeSyntheticClosure(fixture);
  }
});

test('rejects an actual ambiguous lockfile snapshot selection', () => {
  const fixture = syntheticClosure();
  try {
    const lockfile = join(fixture.workspace, 'pnpm-lock.yaml');
    writeFileSync(lockfile, `${readFileSync(lockfile, 'utf8')}  leaf@0.2.4: {}\n`);
    expect(() => inspectTypeClosure(fixture.registration.tree)).toThrow('[package-type-closure]');
  } finally {
    disposeSyntheticClosure(fixture);
  }
});

test.each([
  ['nested source file link', 'linked-file', 'file'],
  ['nested source directory link', 'linked-directory', 'dir'],
  ['broken source link', 'broken-link', 'file'],
] as const)('rejects a %s while copying the closure', (_label, entry, type) => {
  const fixture = syntheticClosure();
  try {
    const target = entry === 'broken-link' ? join(fixture.leafRoot, 'missing') : fixture.leafRoot;
    symlinkSync(target, join(fixture.leafRoot, entry), type);
    const inspection = inspectTypeClosure(fixture.registration.tree);
    expect(() =>
      materializeTypeClosure(fixture.registration.tree, inspection, planTypeClosure(inspection)),
    ).toThrow('[package-isolation-symlink]');
  } finally {
    disposeSyntheticClosure(fixture);
  }
});

test('selects a synthetic three-level closure only through parent-local links', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'package-tree-nonhoisted-'));
  const store = join(workspace, 'node_modules/.pnpm');
  const nodeRoot = join(store, '@types+node@1.0.0/node_modules/@types/node');
  const middleRoot = join(store, 'middle@1.2.0/node_modules/middle');
  const leafRoot = join(store, 'leaf@0.2.4/node_modules/leaf');
  const writePackage = (
    root: string,
    name: string,
    version: string,
    dependencies: Record<string, string>,
  ): void => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name, version, dependencies }));
    writeFileSync(join(root, 'index.d.ts'), 'export {};\n');
  };
  writePackage(nodeRoot, '@types/node', '1.0.0', { middle: '^1.0.0' });
  writePackage(middleRoot, 'middle', '1.2.0', { leaf: '^0.2.3' });
  writePackage(leafRoot, 'leaf', '0.2.4', {});
  mkdirSync(join(workspace, 'node_modules/@types'), { recursive: true });
  symlinkSync(nodeRoot, join(workspace, 'node_modules/@types/node'), 'dir');
  symlinkSync(middleRoot, join(store, '@types+node@1.0.0/node_modules/middle'), 'dir');
  symlinkSync(leafRoot, join(store, 'middle@1.2.0/node_modules/leaf'), 'dir');
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({ devDependencies: { '@types/node': '1.0.0' } }),
  );
  writeFileSync(
    join(workspace, 'pnpm-lock.yaml'),
    `lockfileVersion: '9.0'
importers:
  .:
    devDependencies:
      '@types/node':
        specifier: 1.0.0
        version: 1.0.0
snapshots:
  '@types/node@1.0.0':
    dependencies:
      middle: 1.2.0
  middle@1.2.0:
    dependencies:
      leaf: 0.2.4
  leaf@0.2.4: {}
`,
  );
  const registration = createPackageArtifactTreeForTest(workspace, (path) =>
    rmSync(path, { recursive: true }),
  );
  try {
    writeExtractedPackage(registration.tree);
    const inspection = inspectTypeClosure(registration.tree);
    const plan = planTypeClosure(inspection);
    expect(plan.map(({ name }) => name)).toEqual(['leaf', 'middle', '@types/node']);
    expect(readdirSync(join(workspace, 'node_modules')).sort()).toEqual(['.pnpm', '@types']);
    materializeTypeClosure(registration.tree, inspection, plan);
    expect(readdirSync(join(registration.tree.root, 'node_modules')).sort()).toEqual([
      '@revisium',
      '@types',
      'leaf',
      'middle',
    ]);
  } finally {
    cleanupPackageArtifactTree(registration.owner, registration.tree);
    rmSync(workspace, { recursive: true, force: true });
  }
});
