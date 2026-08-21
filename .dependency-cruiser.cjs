const nodeFileSystem = process.getBuiltinModule('node:fs');
const nodePath = process.getBuiltinModule('node:path');

/**
 * @typedef {{
 *   name: string,
 *   path: string,
 *   dependencies: string[]
 * }} LayerRecord
 */

/**
 * @typedef {{
 *   sourceRoot: string,
 *   rootModule: string,
 *   layers: LayerRecord[]
 * }} LayerManifest
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is LayerRecord} */
function isLayerRecord(value) {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    Array.isArray(value.dependencies) &&
    value.dependencies.every((dependency) => typeof dependency === 'string')
  );
}

/** @param {unknown} value @returns {value is LayerManifest} */
function isLayerManifest(value) {
  return (
    isRecord(value) &&
    typeof value.sourceRoot === 'string' &&
    typeof value.rootModule === 'string' &&
    Array.isArray(value.layers) &&
    value.layers.every(isLayerRecord)
  );
}

/** @param {string} value */
function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** @param {string[]} dependencyNames */
function createProductionDependencyPattern(dependencyNames) {
  return dependencyNames.length === 0
    ? '(?!)'
    : `(?:^|/node_modules/)(?:${dependencyNames.map(escapeRegularExpression).join('|')})(?:/|$)`;
}

/** @param {LayerManifest} manifest @param {string[]} productionDependencyNames */
function createDependencyRules(manifest, productionDependencyNames) {
  const layerPaths = manifest.layers.map((layer) => escapeRegularExpression(layer.path));
  const allLayers = `(?:${layerPaths.join('|')})`;
  const dependencyRules = manifest.layers.flatMap((layer) => {
    const allowed = new Set([layer.name, ...layer.dependencies]);
    const forbidden = manifest.layers
      .filter((candidate) => !allowed.has(candidate.name))
      .map((candidate) => escapeRegularExpression(candidate.path));
    return forbidden.length === 0
      ? []
      : [
          {
            name: `${layer.name}-uses-declared-layer-dependencies`,
            severity: 'error',
            from: { path: `^${escapeRegularExpression(layer.path)}/` },
            to: { path: `^(?:${forbidden.join('|')})/` },
          },
        ];
  });
  const curatedBoundaryRules = manifest.layers.map((layer) => ({
    name: `cross-layer-${layer.name}-imports-use-index`,
    severity: 'error',
    from: {
      pathNot:
        layer.name === 'kernel'
          ? `^(?:${escapeRegularExpression(layer.path)}/|test/support/kernel-internal\\.ts$)`
          : `^${escapeRegularExpression(layer.path)}/`,
    },
    to: {
      path:
        layer.name === 'kernel'
          ? `^${escapeRegularExpression(layer.path)}/(?!index\\.ts$|public\\.ts$)`
          : `^${escapeRegularExpression(layer.path)}/(?!index\\.ts$)`,
    },
  }));
  const rootFacadeSources = [
    'src/foundation/index.ts',
    'src/source/index.ts',
    'src/materialization/index.ts',
    'src/program/index.ts',
    'src/compiler/index.ts',
  ].map(escapeRegularExpression);

  return [
    {
      name: 'no-cycles',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'source-imports-stay-in-source',
      severity: 'error',
      from: { path: `^${escapeRegularExpression(manifest.sourceRoot)}/` },
      to: {
        pathNot: `^${escapeRegularExpression(manifest.sourceRoot)}/`,
        dependencyTypes: ['local'],
      },
    },
    {
      name: 'source-uses-only-node-crypto',
      severity: 'error',
      from: { path: `^${escapeRegularExpression(manifest.sourceRoot)}/` },
      to: { dependencyTypes: ['core'], pathNot: '^crypto$' },
    },
    {
      name: 'production-source-no-nonproduction-dependencies',
      severity: 'error',
      from: { path: `^${escapeRegularExpression(manifest.sourceRoot)}/` },
      to: {
        dependencyTypes: [
          'npm-dev',
          'npm-optional',
          'npm-peer',
          'npm-bundled',
          'npm-no-pkg',
          'npm-unknown',
        ],
      },
    },
    {
      name: 'production-source-only-declared-production-packages',
      severity: 'error',
      from: { path: `^${escapeRegularExpression(manifest.sourceRoot)}/` },
      to: {
        dependencyTypes: ['npm'],
        pathNot: createProductionDependencyPattern(productionDependencyNames),
      },
    },
    {
      name: 'source-imports-must-resolve',
      severity: 'error',
      from: { path: `^${escapeRegularExpression(manifest.sourceRoot)}/` },
      to: {
        path: `^(?:${escapeRegularExpression(manifest.sourceRoot)}/|\\.{1,2}/)`,
        couldNotResolve: true,
      },
    },
    {
      name: 'root-module-uses-only-approved-facade-sources',
      severity: 'error',
      from: { path: `^${escapeRegularExpression(manifest.rootModule)}$` },
      to: { pathNot: `^(?:${rootFacadeSources.join('|')})$` },
    },
    {
      name: 'layers-do-not-import-root-module',
      severity: 'error',
      from: { path: `^${allLayers}/` },
      to: { path: `^${escapeRegularExpression(manifest.rootModule)}$` },
    },
    {
      name: 'layers-do-not-import-revo-run-facade',
      severity: 'error',
      from: { path: `^${allLayers}/` },
      to: { path: '^src/revo-run/' },
    },
    {
      name: 'kernel-public-uses-only-approved-indexes',
      severity: 'error',
      from: { path: '^src/kernel/public\\.ts$' },
      to: {
        pathNot: '^(?:src/foundation/index\\.ts|src/program/index\\.ts|src/kernel/index\\.ts)$',
      },
    },
    {
      name: 'revo-run-public-uses-only-approved-indexes',
      severity: 'error',
      from: { path: '^src/revo-run/' },
      to: {
        pathNot:
          '^(?:src/foundation/index\\.ts|src/source/index\\.ts|src/materialization/index\\.ts|src/program/index\\.ts|src/compiler/index\\.ts|src/revo-run/)',
      },
    },
    {
      name: 'revo-run-private-imports-use-public-facade',
      severity: 'error',
      from: { pathNot: '^(?:src/revo-run/|test/support/revo-run-internal\\.ts$)' },
      to: { path: '^src/revo-run/(?!public\\.ts$)' },
    },
    {
      name: 'private-layers-do-not-import-kernel-public',
      severity: 'error',
      from: { path: `^${allLayers}/`, pathNot: '^src/kernel/public\\.ts$' },
      to: { path: '^src/kernel/public\\.ts$' },
    },
    {
      name: 'publication-boundary-imports-only-kernel-public',
      severity: 'error',
      from: { path: '^test/package/publication-block\\.test\\.ts$' },
      to: { path: '^src/kernel/(?!public\\.ts$)' },
    },
    ...dependencyRules,
    ...curatedBoundaryRules,
  ];
}

/** @type {unknown} */
const manifestInput = JSON.parse(
  nodeFileSystem.readFileSync(nodePath.join(__dirname, 'architecture', 'layers.json'), 'utf8'),
);
if (!isLayerManifest(manifestInput)) {
  throw new Error('architecture/layers.json cannot produce dependency rules');
}

/** @type {unknown} */
const packageInput = JSON.parse(
  nodeFileSystem.readFileSync(nodePath.join(__dirname, 'package.json'), 'utf8'),
);
if (!isRecord(packageInput)) {
  throw new Error('package.json cannot produce dependency rules');
}
const productionDependencyNames = isRecord(packageInput.dependencies)
  ? Object.keys(packageInput.dependencies)
  : [];

module.exports = {
  forbidden: createDependencyRules(manifestInput, productionDependencyNames),
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: 'specify',
  },
};
