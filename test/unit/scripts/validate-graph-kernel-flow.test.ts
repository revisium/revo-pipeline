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

test.each([
  {
    name: 'removes the descriptor bound guard',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (!precheckCompiledBounds(input)) {\n    return { ok: false };\n  }\n',
    to: '',
  },
  {
    name: 'moves the snapshot before descriptor bounds',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
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
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (!precheckCompiledBounds(input)) {',
    to: '  const alternatePrecheck = precheckCompiledBounds;\n  if (!alternatePrecheck(input)) {',
  },
  {
    name: 'uses a dead equality decoy instead of the live comparison',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (expected === undefined || !compareSerializedGraph(snapshot, expected)) {',
    to:
      '  const equalityDecoy = () => compareSerializedGraph(snapshot, expected!);\n' +
      '  void equalityDecoy;\n' +
      '  if (expected === undefined) {',
  },
  {
    name: 'hides expected derivation in a nested closure',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
    to: '  const expected = (() => deriveExpectedCompiledSemantics(snapshot.nodes))();',
  },
  {
    name: 'builds before serialized equality',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
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
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'edges: expected.edges',
    to: 'edges: snapshot.edges',
  },
  {
    name: 'passes a direct expected-edge alias to the builder',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });',
    to:
      '  const edgeAlias = expected.edges;\n' +
      '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: edgeAlias });',
  },
  {
    name: 'passes a transitive expected-edge alias to the builder',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });',
    to:
      '  const edgeAlias = expected.edges;\n' +
      '  const secondAlias = edgeAlias;\n' +
      '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: secondAlias });',
  },
  {
    name: 'spread-overrides the derived builder input',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '{ nodeKeys: expected.nodeKeys, edges: expected.edges }',
    to: '{ nodeKeys: expected.nodeKeys, edges: expected.edges, ...{ edges: snapshot.edges } }',
  },
  {
    name: 'computed-overrides the derived builder input',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '{ nodeKeys: expected.nodeKeys, edges: expected.edges }',
    to: "{ nodeKeys: expected.nodeKeys, ['edges']: snapshot.edges }",
  },
  {
    name: 'duplicates the derived builder input property',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '{ nodeKeys: expected.nodeKeys, edges: expected.edges }',
    to: '{ nodeKeys: expected.nodeKeys, edges: expected.edges, edges: snapshot.edges }',
  },
  {
    name: 'mutates expected semantics after equality',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });',
    to:
      "  Reflect.set(expected.edges[0]!, 'from', 'tampered');\n" +
      '  const built = buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });',
  },
  {
    name: 'rebuilds after equality',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const kernel = built.kernel;',
    to:
      '  void buildGraphKernel({ nodeKeys: expected.nodeKeys, edges: expected.edges });\n' +
      '  const kernel = built.kernel;',
  },
  {
    name: 'rereads the hostile caller after snapshot',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
    to:
      "  void Reflect.get(input as object, 'edges');\n" +
      '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
  },
  {
    name: 'takes a hostile getter path after snapshot',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
    to:
      "  void Object.getOwnPropertyDescriptor(input as object, 'edges')?.get;\n" +
      '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
  },
  {
    name: 'substitutes the topology kernel',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'verifySerializedTopology(snapshot, kernel)',
    to: 'verifySerializedTopology(snapshot, built.kernel)',
  },
  {
    name: 'substitutes the index kernel',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'verifySerializedIndexes(snapshot, kernel)',
    to: 'verifySerializedIndexes(snapshot, built.kernel)',
  },
  {
    name: 'substitutes the success kernel identity',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'return Object.freeze({ ok: true, snapshot, kernel, topologicalOffsets });',
    to: 'return Object.freeze({ ok: true, snapshot, kernel: built.kernel, topologicalOffsets });',
  },
  {
    name: 'substitutes the decision evaluation kernel',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'evaluationIndex(compiled.snapshot, compiled.kernel, compiled.topologicalOffsets)',
    to: 'evaluationIndex(compiled.snapshot, { ...compiled.kernel }, compiled.topologicalOffsets)',
  },
  {
    name: 'exposes the private kernel through the stripping adapter',
    path: 'src/transition/validate-compiled-pipeline.ts',
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
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (snapshot === undefined || !validateCompiledMembers(snapshot)) {',
    to: '  if (snapshot !== undefined || validateCompiledMembers(snapshot!)) {',
  },
  {
    name: 'makes the snapshot member guard non-terminating',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
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
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (expected === undefined || !compareSerializedGraph(snapshot, expected)) {',
    to:
      '  const alternateCompare = compareSerializedGraph;\n' +
      '  if (expected === undefined || !alternateCompare(snapshot, expected)) {',
  },
  {
    name: 'passes serialized node-index keys to the builder',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
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
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'verifySerializedTopology(snapshot, kernel)',
    to: 'verifySerializedTopology({ ...snapshot }, kernel)',
  },
  {
    name: 'substitutes the index snapshot',
    path: 'src/transition/compiled/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'verifySerializedIndexes(snapshot, kernel)',
    to: 'verifySerializedIndexes({ ...snapshot }, kernel)',
  },
  {
    name: 'substitutes the decision topology offsets',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: 'evaluationIndex(compiled.snapshot, compiled.kernel, compiled.topologicalOffsets)',
    to: 'evaluationIndex(compiled.snapshot, compiled.kernel, [...compiled.topologicalOffsets])',
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
    path: 'src/transition/validate-compiled-pipeline.ts',
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
] as const)('rejects PR4b mutant: $name', async ({ path, code, from, to }) => {
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
    'src/transition/compiled/validate-compiled-internally.ts',
    '  const expected = deriveExpectedCompiledSemantics(snapshot.nodes);',
    '  const expected = deriveExpectedCompiledSemantics(unresolvedSnapshot.nodes);',
  );
  expect(validateGraphKernelFlow(root)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
        path: 'src/transition/compiled/validate-compiled-internally.ts',
      }),
    ]),
  );
});

test('fails closed when a tracked path is renamed', async () => {
  expect.hasAssertions();
  const root = await fixture();
  await rename(
    join(root, 'src/transition/compiled/validate-compiled-internally.ts'),
    join(root, 'src/transition/compiled/renamed-validator.ts'),
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
    'src/transition/compiled/validate-compiled-internally.ts',
  );
});
