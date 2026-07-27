import { cp, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { validateGraphKernelFlow } from '../../../scripts/architecture/validate-graph-kernel-flow.js';

const repositoryRoot = process.cwd();
const temporaryRoots: string[] = [];

const PROOF_TO_SCENARIO_TRACEABILITY = [
  ['compiler portable failure', 'builder dominated by portable success'],
  ['compiler reference failure', 'builder dominated by graph-derivable prerequisites'],
  ['compiler graph path', 'exactly one non-repeating compiler call site'],
  ['hostile pre-equality failure', 'builder dominated by semantic equality'],
  ['hostile post-equality rejection', 'one validator call site and no later call'],
  ['successful validation adapter', 'adapter strips kernel and has no builder call'],
  ['successful decision', 'decision calls internal validation once'],
  ['evaluation', 'validator kernel flows unchanged and evaluator has no builder'],
  ['repeated independent public calls', 'no retained-state or cache site'],
] as const;

const fixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'revo-pipeline-graph-flow-'));
  temporaryRoots.push(root);
  await cp(join(repositoryRoot, 'src'), join(root, 'src'), { recursive: true });
  await cp(join(repositoryRoot, 'tsconfig.json'), join(root, 'tsconfig.json'));
  await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
  return root;
};

const replace = async (root: string, path: string, from: string, to: string): Promise<void> => {
  const target = join(root, path);
  const source = await readFile(target, 'utf8');
  expect(source).toContain(from);
  await writeFile(target, source.replace(from, to));
};

const replaceInOrder = async (
  root: string,
  path: string,
  changes: readonly { readonly from: string; readonly to: string }[],
): Promise<void> => {
  const [change, ...remaining] = changes;
  if (!change) {
    return;
  }
  await replace(root, path, change.from, change.to);
  await replaceInOrder(root, path, remaining);
};

const expectViolation = (root: string, code: string, path: string): void => {
  expect(validateGraphKernelFlow(root)).toEqual(
    expect.arrayContaining([expect.objectContaining({ code, path })]),
  );
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

test('accepts the approved graph-kernel build and identity flow', () => {
  expect(validateGraphKernelFlow(repositoryRoot)).toEqual([]);
});

test('maps every runtime scenario to its static proof invariant', () => {
  expect(PROOF_TO_SCENARIO_TRACEABILITY).toHaveLength(9);
  expect(PROOF_TO_SCENARIO_TRACEABILITY.map(([scenario]) => scenario)).toEqual([
    'compiler portable failure',
    'compiler reference failure',
    'compiler graph path',
    'hostile pre-equality failure',
    'hostile post-equality rejection',
    'successful validation adapter',
    'successful decision',
    'evaluation',
    'repeated independent public calls',
  ]);
});

const preDecoderValidatorMutants = new Set([
  'removes the descriptor bound guard',
  'moves the snapshot before descriptor bounds',
  'calls the precheck through an alternate alias',
  'uses a dead equality decoy instead of the live comparison',
  'hides expected derivation in a nested closure',
  'builds before serialized equality',
  'substitutes the success kernel identity',
  'weakens exact serialized edge equality',
  'inverts the snapshot member guard',
  'makes the snapshot member guard non-terminating',
  'calls serialized comparison through an alias',
  'uses a nested six-field edge-equality decoy around a weakened live return',
]);

test.each(
  (
    [
      {
        name: 'removes the descriptor bound guard',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
        from: '  if (!precheckCompiledBounds(input)) {\n    return { ok: false };\n  }\n',
        to: '',
      },
      {
        name: 'moves the snapshot before descriptor bounds',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
        from:
          '  if (!precheckCompiledBounds(input)) {\n' +
          '    return { ok: false };\n' +
          '  }\n' +
          '  const snapshot = snapshotCompiledInput(input);',
        to:
          '  const snapshot = snapshotCompiledInput(input);\n' +
          '  if (!precheckCompiledBounds(input)) {\n' +
          '    return { ok: false };\n' +
          '  }',
      },
      {
        name: 'calls the precheck through an alternate alias',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
        from: '  if (!precheckCompiledBounds(input)) {',
        to: '  const alternatePrecheck = precheckCompiledBounds;\n  if (!alternatePrecheck(input)) {',
      },
      {
        name: 'uses a dead equality decoy instead of the live comparison',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
        from: '  if (expected === undefined || !compareSerializedGraph(snapshot, expected)) {',
        to:
          '  const equalityDecoy = () => compareSerializedGraph(snapshot, expected!);\n' +
          '  void equalityDecoy;\n' +
          '  if (expected === undefined) {',
      },
      {
        name: 'hides expected derivation in a nested closure',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
        from: '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
        to: '  const expected = (() => deriveExpectedCompiledSemantics(snapshot.nodes))();',
      },
      {
        name: 'builds before serialized equality',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
        from:
          '  if (expected === undefined || !compareSerializedGraph(snapshot, expected)) {\n' +
          '    return { ok: false };\n' +
          '  }\n' +
          '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });',
        to:
          '  const built = buildGraphKernel({ nodeKeys: expected!.nodeKeys, edges: expected!.edges });\n' +
          '  if (expected === undefined || !compareSerializedGraph(snapshot, expected)) {\n' +
          '    return { ok: false };\n' +
          '  }',
      },
      {
        name: 'passes serialized hostile edges to the builder',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: 'edges: expected.edges',
        to: 'edges: snapshot.edges',
      },
      {
        name: 'passes a direct expected-edge alias to the builder',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });',
        to:
          '  const edgeAlias = expected.edges;\n' +
          '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: edgeAlias });',
      },
      {
        name: 'passes a transitive expected-edge alias to the builder',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });',
        to:
          '  const edgeAlias = expected.edges;\n' +
          '  const secondAlias = edgeAlias;\n' +
          '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: secondAlias });',
      },
      {
        name: 'spread-overrides the derived builder input',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '{ nodeKeys: expected.nodeKeys, edges: expected.edges }',
        to: '{ nodeKeys: expected.nodeKeys, edges: expected.edges, ...{ edges: snapshot.edges } }',
      },
      {
        name: 'computed-overrides the derived builder input',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '{ nodeKeys: expected.nodeKeys, edges: expected.edges }',
        to: "{ nodeKeys: expected.nodeKeys, ['edges']: snapshot.edges }",
      },
      {
        name: 'duplicates the derived builder input property',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '{ nodeKeys: expected.nodeKeys, edges: expected.edges }',
        to: '{ nodeKeys: expected.nodeKeys, edges: expected.edges, edges: snapshot.edges }',
      },
      {
        name: 'mutates expected semantics after equality',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });',
        to:
          "  Reflect.set(expected.edges[0]!, 'from', 'tampered');\n" +
          '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });',
      },
      {
        name: 'rebuilds after equality',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_REBUILD',
        from: '  const kernel = built.kernel;',
        to:
          '  void buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });\n' +
          '  const kernel = built.kernel;',
      },
      {
        name: 'rereads the hostile caller after snapshot',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
        to:
          "  void Reflect.get(input as object, 'edges');\n" +
          '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
      },
      {
        name: 'takes a hostile getter path after snapshot',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
        to:
          "  void Object.getOwnPropertyDescriptor(input as object, 'edges')?.get;\n" +
          '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
      },
      {
        name: 'substitutes the topology kernel',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_IDENTITY_FLOW',
        from: 'verifySerializedTopology(snapshot, kernel)',
        to: 'verifySerializedTopology(snapshot, built.kernel)',
      },
      {
        name: 'substitutes the index kernel',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_IDENTITY_FLOW',
        from: 'verifySerializedIndexes(snapshot, kernel)',
        to: 'verifySerializedIndexes(snapshot, built.kernel)',
      },
      {
        name: 'substitutes the success kernel identity',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_IDENTITY_FLOW',
        from: 'return Object.freeze({ ok: true, snapshot, kernel, topologicalOffsets });',
        to: 'return Object.freeze({ ok: true, snapshot, kernel: built.kernel, topologicalOffsets });',
      },
      {
        name: 'substitutes the decision evaluation kernel',
        path: 'src/transition/decide-pipeline.ts',
        code: 'GRAPH_KERNEL_IDENTITY_FLOW',
        from: 'buildDecisionContext(compiled)',
        to: 'buildDecisionContext({ ...compiled, kernel: { ...compiled.kernel } })',
      },
      {
        name: 'exposes the private kernel through the stripping adapter',
        path: 'src/transition/decode-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_ADAPTER_EXPOSURE',
        from: '{ ok: true, pipeline: validated.snapshot }',
        to: '{ ok: true, pipeline: validated.snapshot, kernel: validated.kernel }',
      },
      {
        name: 'aliases the fresh expected-edge array directly',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  const regions = deriveRegions(nodes, edges);',
        to: '  const edgeAlias = edges;\n  void edgeAlias;\n  const regions = deriveRegions(nodes, edges);',
      },
      {
        name: 'aliases the fresh expected-edge array transitively',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  const regions = deriveRegions(nodes, edges);',
        to:
          '  const edgeAlias = edges;\n' +
          '  const secondAlias = edgeAlias;\n' +
          '  void secondAlias;\n' +
          '  const regions = deriveRegions(nodes, edges);',
      },
      {
        name: 'mutates an expected structural endpoint',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: "    Reflect.set(edge, 'role', 'readiness');",
        to: "    Reflect.set(edge, 'from', 'tampered');",
      },
      {
        name: 'weakens exact serialized edge equality',
        path: 'src/transition/compiled/compare-serialized-graph.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  actual.branch === expected.branch;',
        to: '  true;',
      },
      {
        name: 'inverts the snapshot member guard',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
        from: '  if (snapshot === undefined || !validateCompiledMembers(snapshot)) {',
        to: '  if (snapshot !== undefined || validateCompiledMembers(snapshot!)) {',
      },
      {
        name: 'makes the snapshot member guard non-terminating',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
        from:
          '  if (snapshot === undefined || !validateCompiledMembers(snapshot)) {\n' +
          '    return { ok: false };\n' +
          '  }',
        to:
          '  if (snapshot === undefined || !validateCompiledMembers(snapshot)) {\n' +
          '    void 0;\n' +
          '  }',
      },
      {
        name: 'calls serialized comparison through an alias',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
        from: '  if (expected === undefined || !compareSerializedGraph(snapshot, expected)) {',
        to:
          '  const alternateCompare = compareSerializedGraph;\n' +
          '  if (expected === undefined || !alternateCompare(snapshot, expected)) {',
      },
      {
        name: 'passes serialized node-index keys to the builder',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: 'nodeKeys: expected.nodeKeys',
        to: 'nodeKeys: snapshot.nodeIndex.map((entry) => entry.key)',
      },
      {
        name: 'spread-overrides the derived semantic result',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  return { nodeKeys: nodes.map((node) => node.key), edges, regions };',
        to: '  return { nodeKeys: nodes.map((node) => node.key), edges, regions, ...{ edges: [] } };',
      },
      {
        name: 'computed-overrides the derived semantic result',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  return { nodeKeys: nodes.map((node) => node.key), edges, regions };',
        to: "  return { nodeKeys: nodes.map((node) => node.key), ['edges']: [], regions };",
      },
      {
        name: 'duplicates the derived semantic result edge property',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  return { nodeKeys: nodes.map((node) => node.key), edges, regions };',
        to: '  return { nodeKeys: nodes.map((node) => node.key), edges, regions, edges: [] };',
      },
      {
        name: 'escapes the expected edge array to an unapproved helper',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  const regions = deriveRegions(nodes, edges);',
        to: '  void Object.freeze(edges);\n  const regions = deriveRegions(nodes, edges);',
      },
      {
        name: 'substitutes the topology snapshot',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_IDENTITY_FLOW',
        from: 'verifySerializedTopology(snapshot, kernel)',
        to: 'verifySerializedTopology({ ...snapshot }, kernel)',
      },
      {
        name: 'substitutes the index snapshot',
        path: 'src/transition/inspect-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_IDENTITY_FLOW',
        from: 'verifySerializedIndexes(snapshot, kernel)',
        to: 'verifySerializedIndexes({ ...snapshot }, kernel)',
      },
      {
        name: 'substitutes the decision topology offsets',
        path: 'src/transition/decide-pipeline.ts',
        code: 'GRAPH_KERNEL_IDENTITY_FLOW',
        from: 'buildDecisionContext(compiled)',
        to: 'buildDecisionContext({ ...compiled, topologicalOffsets: [...compiled.topologicalOffsets] })',
      },
      {
        name: 'uses a nested six-field edge-equality decoy around a weakened live return',
        path: 'src/transition/compiled/compare-serialized-graph.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from:
          'const edgesEqual = (actual: CompiledEdge, expected: CompiledEdge): boolean =>\n' +
          '  actual.from === expected.from &&\n' +
          '  actual.outcome === expected.outcome &&\n' +
          '  actual.to === expected.to &&\n' +
          '  actual.role === expected.role &&\n' +
          '  actual.fork === expected.fork &&\n' +
          '  actual.branch === expected.branch;',
        to:
          'const edgesEqual = (actual: CompiledEdge, expected: CompiledEdge): boolean => {\n' +
          '  const decoy = () =>\n' +
          '    actual.from === expected.from &&\n' +
          '    actual.outcome === expected.outcome &&\n' +
          '    actual.to === expected.to &&\n' +
          '    actual.role === expected.role &&\n' +
          '    actual.fork === expected.fork &&\n' +
          '    actual.branch === expected.branch;\n' +
          '  void decoy;\n' +
          '  return actual.from === expected.from;\n' +
          '};',
      },
      {
        name: 'spread-exposes the private validated result through the adapter',
        path: 'src/transition/decode-compiled-pipeline.ts',
        code: 'GRAPH_KERNEL_ADAPTER_EXPOSURE',
        from: '{ ok: true, pipeline: validated.snapshot }',
        to: '{ ok: true, pipeline: validated.snapshot, ...validated }',
      },
      {
        name: 'rereads pipelineInput after internal validation',
        path: 'src/transition/decide-pipeline.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  if (!compiled.ok) {',
        to: '  void pipelineInput.edges;\n  if (!compiled.ok) {',
      },
      {
        name: 'changes the expected edge endpoint factory',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '  from,\n  outcome,\n  to,',
        to: '  from: to,\n  outcome,\n  to,',
      },
      {
        name: 'routes task outcomes back to the source node key',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: 'return Object.entries(node.outcomes).map(([outcome, to]) => edgeFor(node.key, outcome, to));',
        to: 'return Object.entries(node.outcomes).map(([outcome]) => edgeFor(node.key, outcome, node.key));',
      },
      {
        name: 'changes the expected human-gate outcome',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: 'edgeFor(node.key, route.resolution, route.to)',
        to: "edgeFor(node.key, 'tampered', route.to)",
      },
      {
        name: 'changes the expected initial edge role',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: "  role: 'activation',",
        to: "  role: 'readiness',",
      },
      {
        name: 'changes expected fork ownership',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '        fork: node.key,\n        branch: branch.name,',
        to: '        fork: node.join,\n        branch: branch.name,',
      },
      {
        name: 'changes expected branch ownership',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from: '        fork: node.key,\n        branch: branch.name,',
        to: '        fork: node.key,\n        branch: null,',
      },
      {
        name: 'changes expected edge sort precedence',
        path: 'src/transition/compiled/derive-expected-compiled-semantics.ts',
        code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
        from:
          '  compareUnicodeCodePoints(left.from, right.from) ||\n' +
          '  compareUnicodeCodePoints(left.outcome, right.outcome)',
        to:
          '  compareUnicodeCodePoints(left.outcome, right.outcome) ||\n' +
          '  compareUnicodeCodePoints(left.from, right.from)',
      },
    ] as const
  ).filter(({ name }) => !preDecoderValidatorMutants.has(name)),
)('rejects PR4b mutant: $name', async ({ path, code, from, to }) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(root, path, from, to);
  expectViolation(root, code, path);
});

test.each([
  {
    name: 'second compiler builder',
    path: 'src/definition/compilation/validate-definition-graph.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const kernelBuild = buildGraphKernel({ nodeKeys, edges: inducedEdges });',
    to:
      '  const unusedBuild = buildGraphKernel({ nodeKeys, edges: inducedEdges });\n' +
      '  void unusedBuild;\n' +
      '  const kernelBuild = buildGraphKernel({ nodeKeys, edges: inducedEdges });',
  },
  {
    name: 'compiler builder alias',
    path: 'src/definition/compilation/validate-definition-graph.ts',
    code: 'GRAPH_KERNEL_BUILD_SITE',
    from: '  const kernelBuild = buildGraphKernel({ nodeKeys, edges: inducedEdges });',
    to:
      '  const builder = buildGraphKernel;\n' +
      '  const kernelBuild = builder({ nodeKeys, edges: inducedEdges });',
  },
  {
    name: 'validation dominance bypass',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (!validation.canCompile) {',
    to: '  if (definition === undefined && !validation.canCompile) {',
  },
  {
    name: 'projection input remap',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const projectedGraph = projectPipelineEdges(copiedNodes);',
    to: '  const projectedGraph = projectPipelineEdges(nodes);',
  },
  {
    name: 'graph input remap',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '    edges: projectedGraph.edges,',
    to: '    edges: [],',
  },
  {
    name: 'classification graph alias',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const classifiedRegions = classifyForkRegions({\n    faults,\n    graph,',
    to:
      '  const replacementGraph = { ...graph };\n' +
      '  const classifiedRegions = classifyForkRegions({\n' +
      '    faults,\n' +
      '    graph: replacementGraph,',
  },
  {
    name: 'compiler size guard bypass',
    path: 'src/definition/compilation/validate-definition-graph.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '    nodeKeys.length > PIPELINE_LIMITS.definition.nodes ||',
    to: '    false ||',
  },
  {
    name: 'compiler induced endpoint filter bypass',
    path: 'src/definition/compilation/validate-definition-graph.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '    knownKeys.has(edge.from) && knownKeys.has(edge.to)',
    to: '    true',
  },
  {
    name: 'compiler builder input swap',
    path: 'src/definition/compilation/validate-definition-graph.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const kernelBuild = buildGraphKernel({ nodeKeys, edges: inducedEdges });',
    to: '  const kernelBuild = buildGraphKernel({ nodeKeys, edges });',
  },
  {
    name: 'normalization skips canonical branch-case normalization',
    path: 'src/definition/compilation/normalize-pipeline-node.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '.map(normalizeCase)',
    to: '.map((entry) => entry)',
  },
  {
    name: 'normalization skips consensus candidate ordering',
    path: 'src/definition/compilation/normalize-pipeline-node.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'candidates: [...node.candidates].sort(compareUnicodeCodePoints),',
    to: 'candidates: [...node.candidates],',
  },
  {
    name: 'normalization skips human-gate NFC',
    path: 'src/definition/compilation/normalize-pipeline-node.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: "subject: node.subject.normalize('NFC'),",
    to: 'subject: node.subject,',
  },
  {
    name: 'projection changes the human-gate resolution outcome',
    path: 'src/definition/compilation/project-pipeline-edges.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'edge(entry.resolution, entry.to)',
    to: "edge('tampered', entry.to)",
  },
  {
    name: 'projection changes the package-owned source key',
    path: 'src/definition/compilation/project-pipeline-edges.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'from: node.key,',
    to: "from: 'tampered',",
  },
  {
    name: 'projection changes the initial semantic role',
    path: 'src/definition/compilation/project-pipeline-edges.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: "role: 'activation',",
    to: "role: 'readiness',",
  },
  {
    name: 'projection changes fork branch ownership',
    path: 'src/definition/compilation/project-pipeline-edges.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'branch: branch.name,',
    to: 'branch: null,',
  },
  {
    name: 'projection changes canonical field ordering',
    path: 'src/definition/compilation/project-pipeline-edges.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from:
      'compareUnicodeCodePoints(left.from, right.from) ||\n' +
      '  compareUnicodeCodePoints(left.outcome, right.outcome)',
    to:
      'compareUnicodeCodePoints(left.outcome, right.outcome) ||\n' +
      '  compareUnicodeCodePoints(left.from, right.from)',
  },
  {
    name: 'projection skips the canonical edge sort',
    path: 'src/definition/compilation/project-pipeline-edges.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'nodes.flatMap(edgesForNode).sort(edgeComparator)',
    to: 'nodes.flatMap(edgesForNode)',
  },
  {
    name: 'preflight remaps the barrier endpoint',
    path: 'src/definition/compilation/preflight-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'const barrierNodeOffset = nodeOffsets.get(join.key);',
    to: 'const barrierNodeOffset = nodeOffsets.get(fork.key);',
  },
  {
    name: 'preflight remaps a branch endpoint',
    path: 'src/definition/compilation/preflight-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'entryNodeOffset: nodeOffsets.get(branch.entry),',
    to: 'entryNodeOffset: nodeOffsets.get(branch.exit),',
  },
  {
    name: 'preflight bypasses known-query provenance',
    path: 'src/definition/compilation/preflight-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'const queryIsKnown =\n      barrierNodeOffset !== undefined &&',
    to: 'const queryIsKnown =\n      true &&',
  },
  {
    name: 'reference validation is conditional',
    path: 'src/definition/compilation/validate-definition-graph.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  validateReferences(entry, nodes, projectedEdges, sourceIndexes, faults);',
    to:
      '  if (entry) {\n' +
      '    validateReferences(entry, nodes, projectedEdges, sourceIndexes, faults);\n' +
      '  }',
  },
  {
    name: 'reference validation is out of order',
    path: 'src/definition/compilation/validate-definition-graph.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from:
      '  validateReferences(entry, nodes, projectedEdges, sourceIndexes, faults);\n' +
      '  const edges: MutableCompiledEdge[] = projectedEdges.map((edge) => ({ ...edge }));',
    to:
      '  const edges: MutableCompiledEdge[] = projectedEdges.map((edge) => ({ ...edge }));\n' +
      '  validateReferences(entry, nodes, projectedEdges, sourceIndexes, faults);',
  },
  {
    name: 'compiler induced edges mutate after construction',
    path: 'src/definition/compilation/validate-definition-graph.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const inducedSemanticOffsets = Object.freeze(',
    to:
      "  inducedEdges.push({ from: 'a', outcome: 'x', to: 'b' });\n" +
      '  const inducedSemanticOffsets = Object.freeze(',
  },
  {
    name: 'classification bypasses branch edge permission',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const permittedInternal = fromOwner !== undefined && fromOwner === toOwner;',
    to: '  const permittedInternal = true;',
  },
  {
    name: 'readiness classification changes role provenance',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: "edge.role = 'readiness';",
    to: "edge.role = 'activation';",
  },
  {
    name: 'readiness classification changes fork provenance',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'edge.fork = fork.fork.key;',
    to: 'edge.fork = fork.join.key;',
  },
  {
    name: 'readiness classification changes branch provenance',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'edge.branch = branch.branch.name;',
    to: 'edge.branch = null;',
  },
  {
    name: 'final semantic-offset identity is removed',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        graph.inducedSemanticOffsets[offset] === offset &&',
    to: '        true &&',
  },
  {
    name: 'final semantic-offset identity is inverted',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        graph.inducedSemanticOffsets[offset] === offset &&',
    to: '        graph.inducedSemanticOffsets[offset] !== offset &&',
  },
  {
    name: 'final from identity is removed',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        graph.inducedEdges[offset]?.from === edge.from &&',
    to: '        true &&',
  },
  {
    name: 'final from identity is inverted',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        graph.inducedEdges[offset]?.from === edge.from &&',
    to: '        graph.inducedEdges[offset]?.from !== edge.from &&',
  },
  {
    name: 'final outcome identity is removed',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        graph.inducedEdges[offset]?.outcome === edge.outcome &&',
    to: '        true &&',
  },
  {
    name: 'final outcome identity is inverted',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        graph.inducedEdges[offset]?.outcome === edge.outcome &&',
    to: '        graph.inducedEdges[offset]?.outcome !== edge.outcome &&',
  },
  {
    name: 'final to identity is removed',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        graph.inducedEdges[offset]?.to === edge.to,',
    to: '        true,',
  },
  {
    name: 'final to identity is inverted',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        graph.inducedEdges[offset]?.to === edge.to,',
    to: '        graph.inducedEdges[offset]?.to !== edge.to,',
  },
  {
    name: 'assembly skips deep freeze promotion',
    path: 'src/definition/compilation/assemble-compiled-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'pipeline: deepFreeze({',
    to: 'pipeline: ({',
  },
  {
    name: 'assembly substitutes serialized edges',
    path: 'src/definition/compilation/assemble-compiled-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'edges: graph.edges,',
    to: 'edges: graph.inducedEdges,',
  },
  {
    name: 'assembly changes index input nodes',
    path: 'src/definition/compilation/assemble-compiled-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '...buildIndexes(nodes, graph),',
    to: '...buildIndexes([], graph),',
  },
  {
    name: 'assembly swaps incoming index provenance',
    path: 'src/definition/compilation/assemble-compiled-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'edges: graph.kernel.incomingEdgeOffsets[offset] ?? [],',
    to: 'edges: graph.kernel.outgoingEdgeOffsets[offset] ?? [],',
  },
  {
    name: 'compiler projection call is conditional',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const projectedGraph = projectPipelineEdges(copiedNodes);',
    to: '  const projectedGraph = entry ? projectPipelineEdges(copiedNodes) : { edges: [] };',
  },
  {
    name: 'compiler projection call is aliased',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const projectedGraph = projectPipelineEdges(copiedNodes);',
    to:
      '  const project = projectPipelineEdges;\n' +
      '  const projectedGraph = project(copiedNodes);',
  },
  {
    name: 'compiler projection call is repeated',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const projectedGraph = projectPipelineEdges(copiedNodes);',
    to:
      '  void projectPipelineEdges(copiedNodes);\n' +
      '  const projectedGraph = projectPipelineEdges(copiedNodes);',
  },
  {
    name: 'compiler projection and preflight calls are out of order',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from:
      '  const projectedGraph = projectPipelineEdges(copiedNodes);\n' +
      '  const nodeKeys = copiedNodes.map((node) => node.key);\n' +
      '  const preflight = preflightForkRegions(copiedNodes, nodeKeys, sourceIndexes, sourceNodes, faults);',
    to:
      '  const nodeKeys = copiedNodes.map((node) => node.key);\n' +
      '  const preflight = preflightForkRegions(copiedNodes, nodeKeys, sourceIndexes, sourceNodes, faults);\n' +
      '  const projectedGraph = projectPipelineEdges(copiedNodes);',
  },
  {
    name: 'remapped compiler owner import',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
    from: 'import { validateDefinitionGraph }',
    to: 'import { validateDefinitionGraph as remappedGraph }',
  },
] as const)('rejects $name', async ({ path, code, from, to }) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(root, path, from, to);
  expectViolation(root, code, path);
});

test.each([
  {
    name: 'normalization live human-gate initializer despite a nested exact decoy',
    path: 'src/definition/compilation/normalize-pipeline-node.ts',
    changes: [
      {
        from: 'export const normalizePipelineNode = (node: PipelineNode): PipelineNode => {\n',
        to:
          'export const normalizePipelineNode = (node: PipelineNode): PipelineNode => {\n' +
          "  const decoy = () => ({ subject: node.subject.normalize('NFC') });\n" +
          '  void decoy;\n',
      },
      {
        from: "        subject: node.subject.normalize('NFC'),",
        to: '        subject: node.subject,',
      },
    ],
  },
  {
    name: 'projection live human-gate return despite a nested exact decoy',
    path: 'src/definition/compilation/project-pipeline-edges.ts',
    changes: [
      {
        from:
          "    case 'humanGate':\n" +
          '      return node.resolutions.map((entry) => edge(entry.resolution, entry.to));',
        to:
          "    case 'humanGate': {\n" +
          '      const decoy = () =>\n' +
          '        node.resolutions.map((entry) => edge(entry.resolution, entry.to));\n' +
          '      void decoy;\n' +
          "      return node.resolutions.map((entry) => edge('tampered', entry.to));\n" +
          '    }',
      },
    ],
  },
  {
    name: 'preflight live query initializer and return despite a nested exact decoy',
    path: 'src/definition/compilation/preflight-fork-regions.ts',
    changes: [
      {
        from:
          '    const queryIsKnown =\n' +
          '      barrierNodeOffset !== undefined &&\n' +
          '      queryBranches.every(\n' +
          '        (branch) => branch.entryNodeOffset !== undefined && branch.exitNodeOffset !== undefined,\n' +
          '      );',
        to: '    const queryIsKnown = false;',
      },
      {
        from: '  return { forks, queries };\n};',
        to:
          '  const decoy = () => {\n' +
          '    const queryIsKnown =\n' +
          '      barrierNodeOffset !== undefined &&\n' +
          '      queryBranches.every(\n' +
          '        (branch) => branch.entryNodeOffset !== undefined && branch.exitNodeOffset !== undefined,\n' +
          '      );\n' +
          '    void queryIsKnown;\n' +
          '    return { forks, queries };\n' +
          '  };\n' +
          '  void decoy;\n' +
          '  return { forks: [], queries: [] };\n' +
          '};',
      },
    ],
  },
  {
    name: 'readiness live assignments despite a nested exact decoy',
    path: 'src/definition/compilation/classify-fork-regions.ts',
    changes: [
      {
        from:
          '  for (const edge of exitEdges) {\n' +
          "    edge.role = 'readiness';\n" +
          '    edge.fork = fork.fork.key;\n' +
          '    edge.branch = branch.branch.name;\n' +
          '  }',
        to:
          '  const decoy = (edge: MutableEdge) => {\n' +
          "    edge.role = 'readiness';\n" +
          '    edge.fork = fork.fork.key;\n' +
          '    edge.branch = branch.branch.name;\n' +
          '  };\n' +
          '  void decoy;\n' +
          '  for (const edge of exitEdges) {\n' +
          "    edge.role = 'activation';\n" +
          '    edge.fork = fork.join.key;\n' +
          '    edge.branch = null;\n' +
          '  }',
      },
    ],
  },
  {
    name: 'assembly live promotion and indexes despite a nested exact decoy',
    path: 'src/definition/compilation/assemble-compiled-pipeline.ts',
    changes: [
      {
        from: '  return {\n    ok: true,\n    pipeline: deepFreeze({',
        to:
          '  const decoy = () => ({\n' +
          '    pipeline: deepFreeze({ edges: graph.edges, ...buildIndexes(nodes, graph) }),\n' +
          '  });\n' +
          '  void decoy;\n' +
          '  return {\n' +
          '    ok: true,\n' +
          '    pipeline: ({',
      },
    ],
  },
] as const)('rejects $name', async ({ path, changes }) => {
  expect.hasAssertions();
  const root = await fixture();
  await replaceInOrder(root, path, changes);
  expectViolation(root, 'GRAPH_KERNEL_INPUT_PROVENANCE', path);
});

test.each([
  {
    name: 'normalization spread overrides the proven subject in the same return object',
    path: 'src/definition/compilation/normalize-pipeline-node.ts',
    from: "        subject: node.subject.normalize('NFC'),",
    to: "        subject: node.subject.normalize('NFC'),\n        ...{ subject: node.subject },",
  },
  {
    name: 'assembly spread overrides the proven pipeline in the same return object',
    path: 'src/definition/compilation/assemble-compiled-pipeline.ts',
    from: '      ...buildIndexes(nodes, graph),\n    }),\n  };\n};',
    to: '      ...buildIndexes(nodes, graph),\n    }),\n    ...{ pipeline: undefined },\n  };\n};',
  },
] as const)('rejects $name', async ({ path, from, to }) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(root, path, from, to);
  expectViolation(root, 'GRAPH_KERNEL_INPUT_PROVENANCE', path);
});

test.each([
  {
    name: 'builds a second decision context',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  const context = buildDecisionContext(compiled);',
    to:
      '  const context = buildDecisionContext(compiled);\n' +
      '  const duplicateContext = buildDecisionContext(compiled);\n' +
      '  void duplicateContext;',
  },
  {
    name: 'constructs context before the success guard',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from:
      '  if (!compiled.ok) {\n' +
      '    const invalid = new DecisionFaultCollector();\n' +
      "    invalid.add('PIPELINE_INVALID', '', 'Compiled pipeline is invalid.');\n" +
      '    return invalid.reject();\n' +
      '  }\n' +
      '  const context = buildDecisionContext(compiled);',
    to:
      '  const context = compiled.ok ? buildDecisionContext(compiled) : undefined;\n' +
      '  if (!compiled.ok) {\n' +
      '    const invalid = new DecisionFaultCollector();\n' +
      "    invalid.add('PIPELINE_INVALID', '', 'Compiled pipeline is invalid.');\n" +
      '    return invalid.reject();\n' +
      '  }\n' +
      '  if (!context) throw new Error();',
  },
  {
    name: 'clones the hostile success before context construction',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'buildDecisionContext(compiled)',
    to: 'buildDecisionContext({ ...compiled })',
  },
  {
    name: 'stores a cloned hostile success in context',
    path: 'src/transition/context/build-decision-context.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '    compiled,',
    to: '    compiled: { ...compiled },',
  },
  {
    name: 'passes a distinct context to fact validation',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'validatePipelineFacts(factsInput, context, faults)',
    to: 'validatePipelineFacts(factsInput, buildDecisionContext(compiled), faults)',
  },
  {
    name: 'rebuilds a map inside a selector',
    path: 'src/transition/evaluation/select-fork.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const region = context.regionByFork.get(node.key);',
    to:
      '  const rebuilt = new Map(context.nodeByKey);\n' +
      '  void rebuilt;\n' +
      '  const region = context.regionByFork.get(node.key);',
  },
  {
    name: 'imports and rebuilds a graph kernel in a finder',
    path: 'src/transition/evaluation/find-first-action.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: "import type { PipelineDecision } from '../../errors/index.js';",
    to:
      "import type { PipelineDecision } from '../../errors/index.js';\n" +
      "import { buildGraphKernel } from '../../graph/index.js';\n" +
      'void buildGraphKernel;',
  },
  {
    name: 'feeds a serialized node index into evaluation',
    path: 'src/transition/evaluation/find-first-action.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const pipeline = context.compiled.snapshot;',
    to:
      '  const pipeline = context.compiled.snapshot;\n' +
      '  void context.compiled.snapshot.nodeIndex;',
  },
  {
    name: 'bypasses selectNode in causality',
    path: 'src/transition/evaluation/validate-fact-causality.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '    const selection = selectNode(node, facts, context);',
    to: "    const selection = node.kind === 'branch' ? undefined : undefined;",
  },
  {
    name: 'mutates a context map from a selector',
    path: 'src/transition/evaluation/select-fork.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const region = context.regionByFork.get(node.key);',
    to:
      "  context.nodeByKey.set('mutant', node);\n" +
      '  const region = context.regionByFork.get(node.key);',
  },
  {
    name: 'uses a dynamic import from a finder',
    path: 'src/transition/evaluation/find-first-action.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const pipeline = context.compiled.snapshot;',
    to: "  void import('./selection.js');\n  const pipeline = context.compiled.snapshot;",
  },
  {
    name: 'calls selectNode through a direct alias',
    path: 'src/transition/evaluation/find-first-action.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '    const selection = selectNode(node, facts, context);',
    to: '    const choose = selectNode;\n    const selection = choose(node, facts, context);',
  },
  {
    name: 'hides a second context build in a dead nested decoy',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  const context = buildDecisionContext(compiled);',
    to:
      '  const decoy = () => buildDecisionContext(compiled);\n' +
      '  void decoy;\n' +
      '  const context = buildDecisionContext(compiled);',
  },
  {
    name: 'reorders action and wait precedence',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from:
      '    findFirstAction(facts, context) ??\n' +
      "    findFirstWait(facts, context) ?? { kind: 'noop', reason: 'quiescent' }",
    to:
      '    findFirstWait(facts, context) ??\n' +
      "    findFirstAction(facts, context) ?? { kind: 'noop', reason: 'quiescent' }",
  },
  {
    name: 'uses locale ordering for fork targets',
    path: 'src/transition/evaluation/select-fork.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from:
      '            (context.topologicalPosition.get(left) ?? 0) -\n' +
      '            (context.topologicalPosition.get(right) ?? 0),',
    to: '            left.localeCompare(right),',
  },
  {
    name: 'imports evaluation from facts',
    path: 'src/transition/facts/validate-pipeline-facts.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: "import { inspectPortableValueSet, PIPELINE_LIMITS } from '../../policy/index.js';",
    to:
      "import { inspectPortableValueSet, PIPELINE_LIMITS } from '../../policy/index.js';\n" +
      "import type { Selection } from '../evaluation/selection.js';\n" +
      'type MutantSelection = Selection;',
  },
  {
    name: 'imports causality from a selector',
    path: 'src/transition/evaluation/select-fork.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: "import type { Selection } from './selection.js';",
    to:
      "import type { Selection } from './selection.js';\n" +
      "import { validateFactCausality } from './validate-fact-causality.js';\n" +
      'void validateFactCausality;',
  },
  {
    name: 'uses a computed graph-builder evasion',
    path: 'src/transition/evaluation/find-first-action.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const pipeline = context.compiled.snapshot;',
    to: "  void globalThis['buildGraphKernel'];\n  const pipeline = context.compiled.snapshot;",
  },
] as const)('rejects PR4c mutant: $name', async ({ path, code, from, to }) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(root, path, from, to);
  expectViolation(root, code, path);
});

test.each([
  ['conditional', '  const context = compiled.ok ? buildDecisionContext(compiled) : undefined;'],
  ['logical', '  const context = compiled.ok && buildDecisionContext(compiled);'],
  [
    'ternary alias',
    '  const builder = compiled.ok ? buildDecisionContext : buildDecisionContext;\n' +
      '  const context = builder(compiled);',
  ],
  [
    'callback',
    '  const contexts = [compiled].map(buildDecisionContext);\n' +
      '  const context = contexts[0]!;',
  ],
  [
    'loop',
    '  let context!: ReturnType<typeof buildDecisionContext>;\n' +
      '  for (const success of [compiled]) context = buildDecisionContext(success);',
  ],
  [
    'switch',
    '  let context!: ReturnType<typeof buildDecisionContext>;\n' +
      '  switch (compiled.ok) { default: context = buildDecisionContext(compiled); }',
  ],
  [
    'try',
    '  let context!: ReturnType<typeof buildDecisionContext>;\n' +
      '  try { context = buildDecisionContext(compiled); } catch { throw new Error(); }',
  ],
  [
    'transitive alias',
    '  const builder = buildDecisionContext;\n' +
      '  const transitiveBuilder = builder;\n' +
      '  const context = transitiveBuilder(compiled);',
  ],
  [
    'recursive',
    '  const recursivelyBuild = (remaining: number): ReturnType<typeof buildDecisionContext> =>\n' +
      '    remaining === 0 ? buildDecisionContext(compiled) : recursivelyBuild(remaining - 1);\n' +
      '  const context = recursivelyBuild(0);',
  ],
] as const)('rejects PR4c context-construction evasion: %s', async (_name, replacement) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/decide-pipeline.ts',
    '  const context = buildDecisionContext(compiled);',
    replacement,
  );
  expectViolation(root, 'GRAPH_KERNEL_IDENTITY_FLOW', 'src/transition/decide-pipeline.ts');
});

test.each([
  [
    'snapshot',
    '  const { snapshot, kernel, topologicalOffsets } = compiled;',
    '  const snapshot = { ...compiled.snapshot };\n' +
      '  const { kernel, topologicalOffsets } = compiled;',
  ],
  [
    'kernel',
    '  const { snapshot, kernel, topologicalOffsets } = compiled;',
    '  const kernel = { ...compiled.kernel };\n' +
      '  const { snapshot, topologicalOffsets } = compiled;',
  ],
  [
    'topological offsets',
    '  const { snapshot, kernel, topologicalOffsets } = compiled;',
    '  const topologicalOffsets = [...compiled.topologicalOffsets];\n' +
      '  const { snapshot, kernel } = compiled;',
  ],
] as const)('rejects PR4c stored identity substitution: %s', async (_name, from, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(root, 'src/transition/context/build-decision-context.ts', from, to);
  expectViolation(
    root,
    'GRAPH_KERNEL_IDENTITY_FLOW',
    'src/transition/context/build-decision-context.ts',
  );
});

test.each([
  {
    name: 'direct Map constructor alias in selector',
    path: 'src/transition/evaluation/select-fork.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const region = context.regionByFork.get(node.key);',
    to:
      '  const MapAlias = Map;\n' +
      '  const rebuilt = new MapAlias(context.nodeByKey);\n' +
      '  void rebuilt;\n' +
      '  const region = context.regionByFork.get(node.key);',
  },
  {
    name: 'transitive Set constructor alias in finder',
    path: 'src/transition/evaluation/find-first-action.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const pipeline = context.compiled.snapshot;',
    to:
      '  const SetAlias = Set;\n' +
      '  const TransitiveSet = SetAlias;\n' +
      '  const rebuilt = new TransitiveSet(context.nodeByKey.keys());\n' +
      '  void rebuilt;\n' +
      '  const pipeline = context.compiled.snapshot;',
  },
  {
    name: 'mutates through a context-map alias',
    path: 'src/transition/evaluation/select-fork.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  const region = context.regionByFork.get(node.key);',
    to:
      '  const aliasedMap = context.nodeByKey;\n' +
      "  aliasedMap.set('mutant', node);\n" +
      '  const region = context.regionByFork.get(node.key);',
  },
  {
    name: 'mutates through a transitive facts-map alias',
    path: 'src/transition/evaluation/select-branch.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  const value = facts.valueByKey.get(node.fact);',
    to:
      '  const aliasedMap = facts.valueByKey;\n' +
      '  const transitiveMap = aliasedMap;\n' +
      "  transitiveMap.set('mutant', null);\n" +
      '  const value = facts.valueByKey.get(node.fact);',
  },
  {
    name: 'falls back to serialized nodes from selector',
    path: 'src/transition/evaluation/select-fork.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const region = context.regionByFork.get(node.key);',
    to:
      '  void context.compiled.snapshot.nodes;\n' +
      '  const region = context.regionByFork.get(node.key);',
  },
  {
    name: 'falls back to aliased caller data',
    path: 'src/transition/evaluation/find-first-action.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const pipeline = context.compiled.snapshot;',
    to:
      '  const pipelineInput = context.compiled.snapshot;\n' +
      '  void pipelineInput.nodes;\n' +
      '  const pipeline = context.compiled.snapshot;',
  },
  {
    name: 'passes distinct context to causality',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'validateFactCausality(facts, context, faults)',
    to: 'validateFactCausality(facts, buildDecisionContext(compiled), faults)',
  },
  {
    name: 'passes distinct context to terminal scan',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'findReachedTerminals(facts, context)',
    to: 'findReachedTerminals(facts, buildDecisionContext(compiled))',
  },
  {
    name: 'passes distinct context to action scan',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'findFirstAction(facts, context)',
    to: 'findFirstAction(facts, buildDecisionContext(compiled))',
  },
  {
    name: 'passes distinct context to wait scan',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'findFirstWait(facts, context)',
    to: 'findFirstWait(facts, buildDecisionContext(compiled))',
  },
  {
    name: 'rebuilds incoming index inside scan iteration',
    path: 'src/transition/evaluation/find-first-action.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  for (const key of pipeline.topologicalOrder) {',
    to:
      '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const incoming = new Map(context.incomingByKey);\n' +
      '    void incoming;',
  },
  {
    name: 'rebuilds outgoing index inside scan iteration through alias',
    path: 'src/transition/evaluation/find-first-action.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  for (const key of pipeline.topologicalOrder) {',
    to:
      '  const MapAlias = Map;\n' +
      '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const outgoing = new MapAlias(context.outgoingByKey);\n' +
      '    void outgoing;',
  },
  {
    name: 'rebuilds topological positions per selector scan',
    path: 'src/transition/evaluation/find-first-wait.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  for (const key of context.compiled.snapshot.topologicalOrder) {',
    to:
      '  for (const key of context.compiled.snapshot.topologicalOrder) {\n' +
      '    const positions = new Map(context.topologicalPosition);\n' +
      '    void positions;',
  },
  {
    name: 'rebuilds graph kernel in context through alias',
    path: 'src/transition/context/build-decision-context.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: "import type { CompiledInspection } from '../compiled/compiled-inspection.js';",
    to:
      "import type { CompiledInspection } from '../compiled/compiled-inspection.js';\n" +
      "import { buildGraphKernel } from '../../graph/index.js';\n" +
      'const rebuild = buildGraphKernel;\n' +
      'void rebuild({ nodeKeys: [], edges: [] });',
  },
  {
    name: 'rebuilds graph kernel in selector through transitive alias',
    path: 'src/transition/evaluation/select-fork.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: "import type { PipelineNode } from '../../spec/index.js';",
    to:
      "import type { PipelineNode } from '../../spec/index.js';\n" +
      "import { buildGraphKernel } from '../../graph/index.js';\n" +
      'const rebuild = buildGraphKernel;\n' +
      'const transitiveRebuild = rebuild;\n' +
      'void transitiveRebuild({ nodeKeys: [], edges: [] });',
  },
  {
    name: 'rebuilds graph kernel in finder factory',
    path: 'src/transition/evaluation/find-first-action.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: "import type { PipelineDecision } from '../../errors/index.js';",
    to:
      "import type { PipelineDecision } from '../../errors/index.js';\n" +
      "import { buildGraphKernel } from '../../graph/index.js';\n" +
      'const rebuildFactory = () => buildGraphKernel;\n' +
      'void rebuildFactory()({ nodeKeys: [], edges: [] });',
  },
  {
    name: 'feeds serialized edge index into evaluation',
    path: 'src/transition/evaluation/find-first-action.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const pipeline = context.compiled.snapshot;',
    to:
      '  void context.compiled.snapshot.edgeIndex;\n' +
      '  const pipeline = context.compiled.snapshot;',
  },
  {
    name: 'promotes action before terminal',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  const terminal = terminals[0];',
    to:
      '  const earlyAction = findFirstAction(facts, context);\n' +
      '  if (earlyAction) return earlyAction;\n' +
      '  const terminal = terminals[0];',
  },
  {
    name: 'aliases hostile success before context construction',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  const context = buildDecisionContext(compiled);',
    to:
      '  const successfulCompiled = compiled;\n' +
      '  const context = buildDecisionContext(successfulCompiled);',
  },
  {
    name: 'exports a private context leaf from transition barrel',
    path: 'src/transition/index.ts',
    code: 'GRAPH_KERNEL_ADAPTER_EXPOSURE',
    from: "export { decidePipeline } from './decide-pipeline.js';",
    to:
      "export { decidePipeline } from './decide-pipeline.js';\n" +
      "export type { DecisionContext } from './context/decision-context.js';",
  },
  {
    name: 'uses computed context-builder call',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  const context = buildDecisionContext(compiled);',
    to:
      '  const builders = { buildDecisionContext };\n' +
      "  const context = builders['buildDecisionContext'](compiled);",
  },
  {
    name: 'retries context construction',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  const context = buildDecisionContext(compiled);',
    to:
      '  let context!: ReturnType<typeof buildDecisionContext>;\n' +
      '  for (let attempt = 0; attempt < 2; attempt += 1) {\n' +
      '    context = buildDecisionContext(compiled);\n' +
      '  }',
  },
] as const)('rejects PR4c semantic mutant: $name', async ({ path, code, from, to }) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(root, path, from, to);
  expectViolation(root, code, path);
});

test.each([
  {
    name: 'direct compiled and snapshot alias fallback',
    replacement:
      '  const snapshotAlias = context.compiled.snapshot;\n' +
      '  void snapshotAlias.nodes;\n' +
      '  const pipeline = context.compiled.snapshot;',
  },
  {
    name: 'transitive compiled and snapshot alias fallback',
    replacement:
      '  const compiledAlias = context.compiled;\n' +
      '  const transitiveCompiled = compiledAlias;\n' +
      '  const snapshotAlias = transitiveCompiled.snapshot;\n' +
      '  const transitiveSnapshot = snapshotAlias;\n' +
      '  void transitiveSnapshot.forkRegions;\n' +
      '  const pipeline = context.compiled.snapshot;',
  },
  {
    name: 'per-iteration reconstruction through snapshot collection alias',
    replacement:
      '  const compiledAlias = context.compiled;\n' +
      '  const snapshotAlias = compiledAlias.snapshot;\n' +
      '  const serializedNodes = snapshotAlias.nodes;\n' +
      '  const pipeline = context.compiled.snapshot;\n' +
      '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const rebuilt = serializedNodes.map((node) => [node.key, node] as const);\n' +
      '    void rebuilt;',
    replacesLoop: true,
  },
] as const)(
  'rejects PR4c snapshot provenance mutant: $name',
  async ({ replacement, replacesLoop }) => {
    expect.hasAssertions();
    const root = await fixture();
    if (replacesLoop) {
      await replace(
        root,
        'src/transition/evaluation/find-first-action.ts',
        '  const pipeline = context.compiled.snapshot;\n' +
          '  const byNode = facts.nodeByKey;\n' +
          '  if (!byNode.has(pipeline.entry)) {\n' +
          "    return { kind: 'activate', cause: { kind: 'entry' }, nodeKeys: [pipeline.entry] };\n" +
          '  }\n' +
          '  for (const key of pipeline.topologicalOrder) {',
        replacement.replace(
          '  const pipeline = context.compiled.snapshot;\n',
          '  const pipeline = context.compiled.snapshot;\n' +
            '  const byNode = facts.nodeByKey;\n' +
            '  if (!byNode.has(pipeline.entry)) {\n' +
            "    return { kind: 'activate', cause: { kind: 'entry' }, nodeKeys: [pipeline.entry] };\n" +
            '  }\n',
        ),
      );
    } else {
      await replace(
        root,
        'src/transition/evaluation/find-first-action.ts',
        '  const pipeline = context.compiled.snapshot;',
        replacement,
      );
    }
    expectViolation(
      root,
      'GRAPH_KERNEL_INPUT_PROVENANCE',
      'src/transition/evaluation/find-first-action.ts',
    );
  },
);

test.each([
  {
    name: 'removes the sole hostile snapshot call',
    from: '  const snapshot = snapshotCompiledInput(input, captureFaults);',
    to: '  const snapshot = undefined;',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
  },
  {
    name: 'rereads caller input after capture',
    from: '  const snapshot = snapshotCompiledInput(input, captureFaults);',
    to:
      '  const snapshot = snapshotCompiledInput(input, captureFaults);\n' +
      '  void Object.getOwnPropertyDescriptor(input as object, "nodes");',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
  },
] as const)('rejects PR6 hostile-capture mutant: $name', async ({ from, to, code }) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(root, 'src/transition/inspect-compiled-pipeline.ts', from, to);
  expectViolation(root, code, 'src/transition/inspect-compiled-pipeline.ts');
});

test.each([
  [
    'literal computed access chain',
    "  void context['compiled']['snapshot']['nodes'];\n" +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'nested destructuring',
    '  const { compiled: { snapshot: { nodes } } } = context;\n' +
      '  void nodes;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'renamed and defaulted destructuring aliases',
    '  const { compiled: compiledAlias = context.compiled } = context;\n' +
      '  const { snapshot: snapshotAlias = compiledAlias.snapshot } = compiledAlias;\n' +
      '  const { forkRegions: regionsAlias = snapshotAlias.forkRegions } = snapshotAlias;\n' +
      '  void regionsAlias;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'dynamic computed access fails closed',
    "  const dynamicKey: string = 'nodes';\n" +
      '  void context.compiled.snapshot[dynamicKey];\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'object rest binding fails closed',
    '  const { compiled: { snapshot: { ...snapshotRest } } } = context;\n' +
      '  void snapshotRest;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'array binding from a forbidden collection fails closed',
    '  const [firstNode] = context.compiled.snapshot.nodes;\n' +
      '  void firstNode;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c computed/destructured provenance mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  {
    name: 'per-iteration destructured reconstruction',
    replacement:
      '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const { compiled: { snapshot: { nodes } } } = context;\n' +
      '    const rebuilt = nodes.reduce((index, node) => index.set(node.key, node), new Map());\n' +
      '    void rebuilt;',
  },
  {
    name: 'per-iteration callback-return provenance',
    replacement:
      '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const snapshotFactory = () => context.compiled.snapshot;\n' +
      '    const snapshotAlias = snapshotFactory();\n' +
      '    void snapshotAlias;',
  },
  {
    name: 'per-iteration container laundering',
    replacement:
      '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const identity = <T>(value: T): T => value;\n' +
      '    const leaked = new Map([["snapshot", identity(context.compiled.snapshot)]]);\n' +
      '    void leaked;',
  },
  {
    name: 'per-iteration nested logical provenance',
    replacement:
      '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const leaked = true ? (false || context.compiled.snapshot) : facts.nodeByKey;\n' +
      '    void leaked;',
  },
  {
    name: 'per-iteration class carrier',
    replacement:
      '  for (const key of pipeline.topologicalOrder) {\n' +
      '    class Carrier { readonly payload = { snapshot: context.compiled.snapshot }; }\n' +
      '    void new Carrier();',
  },
  {
    name: 'per-iteration map reconstruction',
    replacement:
      '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const mapAlias = facts.nodeByKey;\n' +
      '    const rebuilt = new Map(mapAlias.entries());\n' +
      '    void rebuilt;',
  },
  {
    name: 'per-iteration class map-value accumulator',
    replacement:
      '  for (const key of pipeline.topologicalOrder) {\n' +
      '    class Carrier { readonly value = context.nodeByKey.get(key); }\n' +
      '    void new Carrier();',
  },
] as const)('rejects PR4c $name', async ({ replacement }) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  for (const key of pipeline.topologicalOrder) {',
    replacement,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  [
    'post-declaration assignment',
    '  let snapshotAlias: unknown;\n' +
      '  snapshotAlias = context.compiled.snapshot;\n' +
      '  void snapshotAlias;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'computed post-declaration assignment',
    '  let snapshotAlias: unknown;\n' +
      "  snapshotAlias = context['compiled']['snapshot'];\n" +
      '  void snapshotAlias;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'assignment destructuring',
    '  let nodes: unknown;\n' +
      '  ({ compiled: { snapshot: { nodes } } } = context);\n' +
      '  void nodes;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'concise callback factory return and call result',
    "  const snapshotFactory = () => context['compiled'].snapshot;\n" +
      '  const snapshotAlias = snapshotFactory();\n' +
      '  void snapshotAlias;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'transitive block factory return and call result',
    '  const compiledAlias = context.compiled;\n' +
      '  const snapshotFactory = () => {\n' +
      '    const transitiveCompiled = compiledAlias;\n' +
      '    return transitiveCompiled.snapshot;\n' +
      '  };\n' +
      '  const snapshotAlias = snapshotFactory();\n' +
      '  void snapshotAlias;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'wrapped computed facts factory return',
    "  const factsFactory = () => ({ payload: facts['nodeByKey'] });\n" +
      '  const leakedFacts = factsFactory();\n' +
      '  void leakedFacts;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c assignment/callback flow mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  [
    'object box',
    '  const boxed = { snapshot: context.compiled.snapshot };\n' +
      '  void boxed;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'array box',
    '  const boxed = [facts.nodeByKey];\n' +
      '  void boxed;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'spread container',
    '  const boxed = { ...context.compiled.snapshot };\n' +
      '  void boxed;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'parameterized identity',
    '  const identity = <T>(value: T): T => value;\n' +
      '  const leaked = identity(context.compiled.snapshot);\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'indirect computed identity',
    '  const helpers = { identity: <T>(value: T): T => value };\n' +
      "  const leaked = helpers['identity'](facts.nodeByKey);\n" +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'transitive call-result wrapper',
    '  const snapshotAlias = context.compiled.snapshot;\n' +
      '  const factory = () => ({ snapshot: snapshotAlias });\n' +
      '  const leaked = factory();\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'tagged template wrapper',
    '  const tag = (_strings: TemplateStringsArray, value: unknown): unknown => value;\n' +
      '  const leaked = tag`${context.compiled.snapshot}`;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'comma wrapper',
    '  const leaked = (undefined, facts.nodeByKey);\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c wrapper laundering mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  {
    name: 'swapped selectNode context and facts',
    path: 'src/transition/evaluation/find-first-action.ts',
    from: 'selectNode(node, facts, context)',
    to: 'selectNode(node, context as any, facts as any)',
  },
  {
    name: 'snapshot passed to validator context slot',
    path: 'src/transition/facts/validate-pipeline-facts.ts',
    from: 'validateCandidateVerdicts(verdicts, context, faults)',
    to: 'validateCandidateVerdicts(verdicts, context.compiled.snapshot as any, faults)',
  },
  {
    name: 'swapped causality context and facts',
    path: 'src/transition/evaluation/validate-fact-causality.ts',
    from: 'validateActivations(facts, context, faults)',
    to: 'validateActivations(context as any, facts as any, faults)',
  },
] as const)('rejects PR4c approved-call provenance mismatch: $name', async ({ path, from, to }) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(root, path, from, to);
  expectViolation(root, 'GRAPH_KERNEL_INPUT_PROVENANCE', path);
});

test.each([
  [
    'ternary',
    '  const leaked = true ? context.compiled.snapshot : undefined;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'logical and',
    '  const leaked = true && facts.nodeByKey;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'logical or',
    '  const leaked = undefined || context.compiled.snapshot;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'nullish coalescing',
    '  const leaked = undefined ?? facts.nodeByKey;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'nested mixed wrappers',
    '  const leaked = true\n' +
      '    ? (undefined ?? context.compiled.snapshot)\n' +
      '    : (false || facts.nodeByKey);\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c conditional/logical provenance mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  [
    'direct binding default',
    '  const { missing = context.compiled.snapshot } = {};\n' +
      '  void missing;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'nested renamed binding default',
    '  const { outer: { inner: leaked = facts.nodeByKey } = {} } = {};\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'computed binding default',
    "  const property = 'missing';\n" +
      '  const { [property]: leaked = context.compiled.snapshot } = {};\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'wrapped binding default',
    '  const { missing = { payload: facts.nodeByKey } } = {};\n' +
      '  void missing;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c binding-default provenance mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  [
    'class expression field',
    '  const Carrier = class { readonly payload = context.compiled.snapshot; };\n' +
      '  void new Carrier();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'local class declaration field',
    '  class Carrier { readonly payload = facts.nodeByKey; }\n' +
      '  void new Carrier();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'static class field',
    '  class Carrier { static readonly payload = context.compiled.snapshot; }\n' +
      '  void Carrier.payload;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c class-carrier provenance mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  [
    'direct entries call',
    '  void context.nodeByKey.entries();\n  const pipeline = context.compiled.snapshot;',
  ],
  [
    'transitive values call',
    '  const firstAlias = facts.nodeByKey;\n' +
      '  const secondAlias = firstAlias;\n' +
      '  void secondAlias.values();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'computed keys call',
    "  void context['nodeByKey']['keys']();\n  const pipeline = context.compiled.snapshot;",
  ],
  [
    'forEach call',
    '  context.nodeByKey.forEach(() => undefined);\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'iterator call',
    '  void context.nodeByKey[Symbol.iterator]();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'map spread',
    '  const leaked = [...facts.nodeByKey];\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'for-of map iteration',
    '  for (const entry of context.nodeByKey) {\n' +
      '    void entry;\n' +
      '  }\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'map iteration destructuring',
    '  const [firstEntry] = facts.nodeByKey;\n' +
      '  void firstEntry;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c map receiver/iteration mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  [
    'direct get result pushed to array',
    '  const leakedNode = context.nodeByKey.get("missing");\n' +
      '  const bucket: unknown[] = [];\n' +
      '  bucket.push(leakedNode);\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'transitive get result pushed to array',
    '  const leakedNode = context.nodeByKey.get("missing");\n' +
      '  const firstAlias = leakedNode;\n' +
      '  const secondAlias = firstAlias;\n' +
      '  const bucket: unknown[] = [];\n' +
      '  bucket.unshift(secondAlias);\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'get result assigned to object index',
    '  const leakedNode = context.nodeByKey.get("missing");\n' +
      '  const bucket: Record<string, unknown> = {};\n' +
      '  bucket["node"] = leakedNode;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'get result accumulated in Map',
    '  const leakedNode = context.nodeByKey.get("missing");\n' +
      '  const bucket = new Map<string, unknown>();\n' +
      '  bucket.set("node", leakedNode);\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'get result object wrapper',
    '  const leakedNode = context.nodeByKey.get("missing");\n' +
      '  const boxed = { leakedNode };\n' +
      '  void boxed;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'get result callback return',
    '  const leakedNode = context.nodeByKey.get("missing");\n' +
      '  const factory = () => leakedNode;\n' +
      '  void factory;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c approved-get result escape mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test('rejects PR4c cross-iteration get-result reconstruction', async () => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    '  const escapedNodes: unknown[] = [];\n  const pipeline = context.compiled.snapshot;',
  );
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  for (const key of pipeline.topologicalOrder) {',
    '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const leakedNode = context.nodeByKey.get(key);\n' +
      '    escapedNodes.push(leakedNode);',
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  [
    'IIFE parameter default',
    '  ((value = context.nodeByKey.get("missing")) => void value)();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'named callback parameter default',
    '  function factory(value = context.nodeByKey.get("missing")) { return value; }\n' +
      '  void factory();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'arrow callback parameter default',
    '  const factory = (value = facts.nodeByKey.get("missing")) => value;\n' +
      '  void factory();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'nested destructured parameter default',
    '  const factory = ({ nested: { value = context.nodeByKey.get("missing") } = {} } = {}) => value;\n' +
      '  void factory();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'computed renamed parameter default',
    "  const property = 'value';\n" +
      '  const factory = ({ [property]: renamed = context.nodeByKey.get("missing") } = {}) => renamed;\n' +
      '  void factory();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'captured pre-bound map value default',
    '  const leakedNode = context.nodeByKey.get("missing");\n' +
      '  const factory = (value = leakedNode) => value;\n' +
      '  void factory();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'rest binding with wrapped parameter default',
    '  const leakedNode = context.nodeByKey.get("missing");\n' +
      '  const factory = ({ ...rest } = { value: leakedNode }) => rest;\n' +
      '  void factory();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c map-value parameter-default mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test('rejects PR4c per-loop map-value default accumulator', async () => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  for (const key of pipeline.topologicalOrder) {',
    '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const leakedNode = context.nodeByKey.get(key);\n' +
      '    const accumulate = (bucket = [leakedNode]) => bucket;\n' +
      '    void accumulate();',
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  [
    'instance field map value',
    '  class Carrier { readonly value = context.nodeByKey.get("missing"); }\n' +
      '  void new Carrier();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'static field map value',
    '  class Carrier { static readonly value = facts.nodeByKey.get("missing"); }\n' +
      '  void Carrier.value;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'class expression field map value',
    '  const Carrier = class { readonly value = context.nodeByKey.get("missing"); };\n' +
      '  void new Carrier();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'decorator map value',
    '  @(context.nodeByKey.get("missing") as any)\n' +
      '  class Carrier {}\n' +
      '  void Carrier;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'static block map value',
    '  class Carrier {\n' +
      '    static { const value = context.nodeByKey.get("missing"); void value; }\n' +
      '  }\n' +
      '  void Carrier;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'shared root and map-value field sink',
    '  class Carrier {\n' +
      '    readonly root = context.compiled.snapshot;\n' +
      '    readonly value = context.nodeByKey.get("missing");\n' +
      '  }\n' +
      '  void new Carrier();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c shared class escape-sink mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  [
    'direct optional key projection',
    '  const leaked = context.nodeByKey.get("missing")?.key;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'transitive kind projection',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const transitiveAlias = nodeAlias;\n' +
      '  const leaked = transitiveAlias?.kind;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'literal computed projection',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      "  const leaked = nodeAlias?.['key'];\n" +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'nested outcomes projection',
    '  const nodeAlias = context.nodeByKey.get("missing") as any;\n' +
      '  const leaked = nodeAlias?.outcomes?.approved;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'nested cases projection',
    '  const nodeAlias = context.nodeByKey.get("missing") as any;\n' +
      '  const leaked = nodeAlias?.cases?.[0]?.to;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'nested resolutions projection',
    '  const nodeAlias = context.nodeByKey.get("missing") as any;\n' +
      '  const leaked = nodeAlias?.resolutions?.[0]?.to;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'dynamic computed projection',
    '  const nodeAlias = context.nodeByKey.get("missing") as any;\n' +
      "  const property: string = 'key';\n" +
      '  const leaked = nodeAlias?.[property];\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c map-value projection mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test('rejects PR4c per-loop projected-value reconstruction', async () => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    '  const projected: unknown[] = [];\n' +
      '  const byKey: Record<string, unknown> = {};\n' +
      '  const pipeline = context.compiled.snapshot;',
  );
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  for (const key of pipeline.topologicalOrder) {',
    '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const nodeAlias = context.nodeByKey.get(key);\n' +
      '    projected.push(nodeAlias?.key);\n' +
      '    byKey[key] = nodeAlias?.kind;',
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  [
    'left-hand string concatenation',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = "node:" + nodeAlias?.key;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'right-hand string concatenation',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = nodeAlias?.key + ":node";\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'template interpolation',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = `node:${nodeAlias?.key}`;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'numeric unary transform',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = +(nodeAlias?.key as any);\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'stored equality result',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = nodeAlias?.kind === "task";\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'nested transform',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = !(nodeAlias?.key + "!");\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'computed property key',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = { [nodeAlias?.key ?? "missing"]: true };\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'comma transform',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = (0, nodeAlias?.key);\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'postfix unary transform',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  let numericAlias = nodeAlias as any;\n' +
      '  const leaked = numericAlias++;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'tagged template transform',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = String.raw`node:${nodeAlias?.key}`;\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'call transform',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = String(nodeAlias?.key);\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'constructor transform',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = new String(nodeAlias?.key);\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'await transform',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = (async () => await nodeAlias?.key)();\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'yield transform',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const leaked = (function* () { yield nodeAlias?.key; })();\n' +
      '  void leaked;\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c transformed map-value mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test('rejects PR4c per-loop transformed accumulation', async () => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    '  const transformed: unknown[] = [];\n  const pipeline = context.compiled.snapshot;',
  );
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  for (const key of pipeline.topologicalOrder) {',
    '  for (const key of pipeline.topologicalOrder) {\n' +
      '    const nodeAlias = context.nodeByKey.get(key);\n' +
      '    transformed.push("node:" + nodeAlias?.key);',
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test.each([
  [
    'block-arrow transformed return through call accumulation',
    '  const accumulated: unknown[] = [];\n' +
      '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const project = () => { return "node:" + nodeAlias?.key; };\n' +
      '  accumulated.push(project());\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'function transformed return through call accumulation',
    '  const accumulated: unknown[] = [];\n' +
      '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  function project() { return "node:" + nodeAlias?.key; }\n' +
      '  accumulated.push(project());\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'concise-arrow transformed return through call accumulation',
    '  const accumulated: unknown[] = [];\n' +
      '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const project = () => "node:" + nodeAlias?.key;\n' +
      '  accumulated.push(project());\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'yield transformed return through call accumulation',
    '  const accumulated: unknown[] = [];\n' +
      '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  function* project() { yield "node:" + nodeAlias?.key; }\n' +
      '  accumulated.push(...project());\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
  [
    'empty transformed-provenance extraction',
    '  const nodeAlias = context.nodeByKey.get("missing");\n' +
      '  const project = () => { return nodeAlias?.key === "missing"; };\n' +
      '  void project();\n' +
      '  const pipeline = context.compiled.snapshot;',
  ],
] as const)('rejects PR4c transformed return escape mutant: %s', async (_name, to) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(
    root,
    'src/transition/evaluation/find-first-action.ts',
    '  const pipeline = context.compiled.snapshot;',
    to,
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_INPUT_PROVENANCE',
    'src/transition/evaluation/find-first-action.ts',
  );
});

test('fails closed on a parse failure', async () => {
  const root = await fixture();
  await replace(
    root,
    'src/definition/compile-pipeline.ts',
    'export const compilePipeline',
    'export const =',
  );
  expect(validateGraphKernelFlow(root)).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN' })]),
  );
});

test('fails closed on a semantic-resolution failure', async () => {
  const root = await fixture();
  await replace(
    root,
    'src/transition/inspect-compiled-pipeline.ts',
    '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
    '  const expected = deriveExpectedCompiledSemantics(unresolvedSnapshot.nodes);',
  );
  expect(validateGraphKernelFlow(root)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
        path: 'src/transition/inspect-compiled-pipeline.ts',
      }),
    ]),
  );
});

test('fails closed when a tracked path is renamed', async () => {
  expect.hasAssertions();
  const root = await fixture();
  await rename(
    join(root, 'src/transition/inspect-compiled-pipeline.ts'),
    join(root, 'src/transition/compiled/renamed-validator.ts'),
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
    'src/transition/inspect-compiled-pipeline.ts',
  );
});
