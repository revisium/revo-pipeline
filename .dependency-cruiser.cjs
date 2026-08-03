const layers = ['spec', 'policy', 'errors', 'graph', 'definition', 'transition'];
const privateLayerRules = layers.map((layer) => ({
  name: `no-private-${layer}-imports`,
  severity: 'error',
  from: { pathNot: `^src/${layer}/` },
  to: { path: `^src/${layer}/(?!index\\.ts$)` },
}));

module.exports = {
  forbidden: [
    {
      name: 'no-cycles',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'spec-has-no-layer-dependencies',
      severity: 'error',
      from: { path: '^src/spec/' },
      to: { path: '^src/(?:policy|errors|graph|definition|transition)/' },
    },
    {
      name: 'policy-has-no-layer-dependencies',
      severity: 'error',
      from: { path: '^src/policy/' },
      to: { path: '^src/(?:spec|errors|graph|definition|transition)/' },
    },
    {
      name: 'errors-depend-downward',
      severity: 'error',
      from: { path: '^src/errors/' },
      to: { path: '^src/(?:graph|definition|transition)/' },
    },
    {
      name: 'graph-depends-downward',
      severity: 'error',
      from: { path: '^src/graph/' },
      to: { path: '^src/(?:definition|transition)/' },
    },
    {
      name: 'definition-does-not-depend-on-transition',
      severity: 'error',
      from: { path: '^src/definition/' },
      to: { path: '^src/transition/' },
    },
    {
      name: 'transition-does-not-depend-on-definition',
      severity: 'error',
      from: { path: '^src/transition/' },
      to: { path: '^src/definition/' },
    },
    {
      name: 'production-stays-in-src',
      severity: 'error',
      from: { path: '^src/' },
      to: { pathNot: '^src/', dependencyTypes: ['local'] },
    },
    {
      name: 'internal-does-not-import-root',
      severity: 'error',
      from: { path: '^src/.+/' },
      to: { path: '^src/index\\.ts$' },
    },
    {
      name: 'production-does-not-import-node-builtins',
      severity: 'error',
      from: { path: '^src/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'production-has-no-external-runtime-dependencies',
      severity: 'error',
      from: { path: '^src/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg'],
        preCompilationOnly: false,
      },
    },
    {
      name: 'production-imports-must-resolve',
      severity: 'error',
      from: { path: '^src/' },
      to: { couldNotResolve: true },
    },
    ...privateLayerRules,
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: 'specify',
  },
};
