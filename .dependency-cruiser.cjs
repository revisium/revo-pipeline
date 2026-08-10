module.exports = {
  forbidden: [
    {
      name: 'no-cycles',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'source-imports-stay-in-source',
      severity: 'error',
      from: { path: '^src/' },
      to: { pathNot: '^src/', dependencyTypes: ['local'] },
    },
    {
      name: 'source-imports-must-resolve',
      severity: 'error',
      from: { path: '^src/' },
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: 'specify',
  },
};
