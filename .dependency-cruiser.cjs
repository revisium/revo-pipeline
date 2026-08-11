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
    from: { pathNot: `^${escapeRegularExpression(layer.path)}/` },
    to: { path: `^${escapeRegularExpression(layer.path)}/(?!index\\.ts$)` },
  }));

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
      name: 'root-module-has-no-imports',
      severity: 'error',
      from: { path: `^${escapeRegularExpression(manifest.rootModule)}$` },
      to: {},
    },
    {
      name: 'layers-do-not-import-root-module',
      severity: 'error',
      from: { path: `^${allLayers}/` },
      to: { path: `^${escapeRegularExpression(manifest.rootModule)}$` },
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
