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
    name: 'validator builder before semantic equality',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: 'canonicalRegions(pipeline, expectedEdges)',
    to: 'regionsMatch(pipeline, expectedEdges)',
  },
  {
    name: 'hostile validator removes the non-record root guard',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (!isCompiledPipelineShape(inspected.value)) {\n    return { ok: false };\n  }',
    to: '  void isCompiledPipelineShape;',
  },
  {
    name: 'hostile validator bypasses the non-record root guard',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (!isCompiledPipelineShape(inspected.value)) {',
    to: '  if (input === undefined && !isCompiledPipelineShape(inspected.value)) {',
  },
  {
    name: 'hostile validator inverts the non-record root guard',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (!isCompiledPipelineShape(inspected.value)) {',
    to: '  if (isCompiledPipelineShape(inspected.value)) {',
  },
  {
    name: 'validator region guard has wrong polarity',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (!canonicalRegions(pipeline, expectedEdges)) {',
    to: '  if (canonicalRegions(pipeline, expectedEdges)) {',
  },
  {
    name: 'validator region guard does not terminate',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (!canonicalRegions(pipeline, expectedEdges)) {\n    return undefined;\n  }',
    to: '  if (!canonicalRegions(pipeline, expectedEdges)) {\n    void 0;\n  }',
  },
  {
    name: 'validator region guard has a fallthrough else',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (!canonicalRegions(pipeline, expectedEdges)) {\n    return undefined;\n  }',
    to: '  if (!canonicalRegions(pipeline, expectedEdges)) {\n    return undefined;\n  } else {\n    void 0;\n  }',
  },
  {
    name: 'validator region guard short-circuits its prerequisite',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  if (!canonicalRegions(pipeline, expectedEdges)) {',
    to: '  if (pipeline.entry === "" || !canonicalRegions(pipeline, expectedEdges)) {',
  },
  {
    name: 'validator equality guard is inverted',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '    !pipeline.edges.every((edge, index) => {',
    to: '    pipeline.edges.every((edge, index) => {',
  },
  {
    name: 'validator builder seeded from serialized edges',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '    edges: expectedEdges,\n  });',
    to: '    edges: pipeline.edges,\n  });',
  },
  {
    name: 'validator builder seeded from an aliased hostile collection',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from:
      '  const built = buildGraphKernel({\n' +
      '    nodeKeys: pipeline.nodes.map((node) => node.key),\n' +
      '    edges: expectedEdges,\n' +
      '  });',
    to:
      '  const serializedEdges = pipeline.edges;\n' +
      '  const built = buildGraphKernel({\n' +
      '    nodeKeys: pipeline.nodes.map((node) => node.key),\n' +
      '    edges: serializedEdges,\n' +
      '  });',
  },
  {
    name: 'validator builder seeded from serialized indexes',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '    nodeKeys: pipeline.nodes.map((node) => node.key),',
    to: '    nodeKeys: pipeline.nodeIndex.map((entry) => entry.key),',
  },
  {
    name: 'validator appends hostile serialized edges after initialization',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const facts = new Map(pipeline.facts.map((fact) => [fact.key, fact.type]));',
    to: '  expectedEdges.push(...pipeline.edges);\n  const facts = new Map(pipeline.facts.map((fact) => [fact.key, fact.type]));',
  },
  {
    name: 'validator mutates expected edges through an alias',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const facts = new Map(pipeline.facts.map((fact) => [fact.key, fact.type]));',
    to: '  const alias = expectedEdges;\n  alias.push(...pipeline.edges);\n  const facts = new Map(pipeline.facts.map((fact) => [fact.key, fact.type]));',
  },
  {
    name: 'validator mutates expected edges through a two-hop alias',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const facts = new Map(pipeline.facts.map((fact) => [fact.key, fact.type]));',
    to: '  const alias = expectedEdges;\n  const secondAlias = alias;\n  secondAlias.push(...pipeline.edges);\n  const facts = new Map(pipeline.facts.map((fact) => [fact.key, fact.type]));',
  },
  {
    name: 'validator mutates expected edges after equality',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const built = buildGraphKernel({',
    to: '  expectedEdges.push(...pipeline.edges);\n  const built = buildGraphKernel({',
  },
  {
    name: 'validator passes expected edges to an unknown helper',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  expectedEdges.sort(edgeComparator);',
    to: '  mutateUnknown(expectedEdges);\n  expectedEdges.sort(edgeComparator);',
  },
  {
    name: 'validator normalization mutates an endpoint',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: "      Reflect.set(edge, 'role', 'readiness');",
    to: "      Reflect.set(edge, 'from', 'tampered');",
  },
  {
    name: 'hostile facts map aliases serialized edges',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const facts = new Map(pipeline.facts.map((fact) => [fact.key, fact.type]));',
    to: '  const facts = new Map(pipeline.edges.map((edge) => [edge.from, edge.to]));',
  },
  {
    name: 'hostile node-key set aliases serialized node index',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const nodeKeys = new Set(pipeline.nodes.map((node) => node.key));',
    to: '  const nodeKeys = new Set(pipeline.nodeIndex.map((entry) => entry.key));',
  },
  {
    name: 'hostile adjacency map escapes through a helper',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const outgoing = new Map<string, string[]>();',
    to: '  const outgoing = new Map<string, string[]>();\n  escapeUnknown(outgoing);',
  },
  {
    name: 'hostile traversal queue accepts an unproven alias',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '    const pending = [start];',
    to: '    const pending = hostilePending;',
  },
  {
    name: 'hostile ownership map escapes through a multi-hop alias',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const memberOwner = new Map<string, MemberOwner>();',
    to: '  const memberOwner = new Map<string, MemberOwner>();\n  const ownerAlias = memberOwner;\n  const secondOwnerAlias = ownerAlias;\n  escapeUnknown(secondOwnerAlias);',
  },
  {
    name: 'hostile count map accepts an unproven mutation',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const internalIncoming = new Map<string, number>();',
    to: "  const internalIncoming = new Map<string, number>();\n  internalIncoming.set('hostile', -1);",
  },
  {
    name: 'validator later rejection rebuilds',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const kernel = built.kernel;',
    to: '  const rebuilt = buildGraphKernel({ nodeKeys: pipeline.nodes.map((node) => node.key), edges: expectedEdges });\n  void rebuilt;\n  const kernel = built.kernel;',
  },
  {
    name: 'stripping adapter calls builder',
    path: 'src/transition/validate-compiled-pipeline.ts',
    code: 'GRAPH_KERNEL_BUILD_SITE',
    from: '  const validated = validateCompiledInternally(input);',
    to: '  const forbidden = buildGraphKernel({ nodeKeys: [], edges: [] });\n  void forbidden;\n  const validated = validateCompiledInternally(input);',
  },
  {
    name: 'stripping adapter exposes kernel',
    path: 'src/transition/validate-compiled-pipeline.ts',
    code: 'GRAPH_KERNEL_ADAPTER_EXPOSURE',
    from: '{ ok: true, pipeline: validated.pipeline }',
    to: '{ ok: true, pipeline: validated.pipeline, kernel: validated.kernel }',
  },
  {
    name: 'decision calls internal validator twice',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  const compiled = validateCompiledInternally(pipelineInput);',
    to: '  void validateCompiledInternally(pipelineInput);\n  const compiled = validateCompiledInternally(pipelineInput);',
  },
  {
    name: 'internal promotion helper is called twice',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_BUILD_REPEAT',
    from: '  const graph = canonicalCoreGraph(pipeline);',
    to: '  void canonicalCoreGraph(pipeline);\n  const graph = canonicalCoreGraph(pipeline);',
  },
  {
    name: 'internal promotion helper is conditionally called',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  const graph = canonicalCoreGraph(pipeline);',
    to: '  const graph = pipeline.entry ? canonicalCoreGraph(pipeline) : undefined;',
  },
  {
    name: 'evaluator receives a builder factory',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  kernel: GraphKernel,',
    to: '  kernel: () => GraphKernel,',
  },
  {
    name: 'evaluator clones its kernel',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const regionOwnerByNode = new Map<string, string>();',
    to: '  const cloned = structuredClone(kernel);\n  void cloned;\n  const regionOwnerByNode = new Map<string, string>();',
  },
  {
    name: 'evaluator spreads its kernel',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const regionOwnerByNode = new Map<string, string>();',
    to: '  const cloned = { ...kernel };\n  void cloned;\n  const regionOwnerByNode = new Map<string, string>();',
  },
  {
    name: 'evaluator rebuilds adjacency',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const regionOwnerByNode = new Map<string, string>();',
    to: '  pipeline.edges.reduce((value) => value, pipeline.edges[0]);\n  const regionOwnerByNode = new Map<string, string>();',
  },
  {
    name: 'kernel binding has conditional substitution',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  const regionOwnerByNode = new Map<string, string>();',
    to: '  const selectedKernel = pipeline ? kernel : kernel;\n  void selectedKernel;\n  const regionOwnerByNode = new Map<string, string>();',
  },
  {
    name: 'kernel binding is reassigned',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_IDENTITY_FLOW',
    from: '  const regionOwnerByNode = new Map<string, string>();',
    to: '  kernel = kernel;\n  const regionOwnerByNode = new Map<string, string>();',
  },
  {
    name: 'kernel stored in a module cache',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_CACHE',
    from: 'type MutableFault =',
    to: 'const retainedKernel: GraphKernel | undefined = undefined;\nvoid retainedKernel;\ntype MutableFault =',
  },
  {
    name: 'kernel stored in a WeakMap',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_CACHE',
    from: 'type MutableFault =',
    to: 'const kernelCache = new WeakMap<object, GraphKernel>();\nvoid kernelCache;\ntype MutableFault =',
  },
  {
    name: 'kernel stored in a Map',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_CACHE',
    from: 'type MutableFault =',
    to: 'const kernelCache = new Map<string, GraphKernel>();\nvoid kernelCache;\ntype MutableFault =',
  },
  {
    name: 'kernel stored in a class field',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_CACHE',
    from: 'type MutableFault =',
    to: 'class KernelOwner { retained?: GraphKernel }\nvoid KernelOwner;\ntype MutableFault =',
  },
  {
    name: 'kernel stored globally',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_CACHE',
    from: '  const regionOwnerByNode = new Map<string, string>();',
    to: '  globalThis.kernel = kernel;\n  const regionOwnerByNode = new Map<string, string>();',
  },
  {
    name: 'kernel captured by returned closure',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_CACHE',
    from: '  const regionOwnerByNode = new Map<string, string>();',
    to: '  if (pipeline.entry === "never") return () => kernel;\n  const regionOwnerByNode = new Map<string, string>();',
  },
  {
    name: 'hostile branch integrity helper changes outside owner digests',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const factType = facts.get(node.fact);',
    to: '  const factType = undefined;',
  },
  {
    name: 'hostile expected-edge helper changes outside owner digests',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: "...edgeFor(node.key, 'forked', branch.entry),",
    to: "...edgeFor(node.key, 'tampered', branch.entry),",
  },
  {
    name: 'hostile outer precheck helper changes outside owner digests',
    path: 'src/transition/validate-compiled-internally.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'const precheckCompiledBounds = (input: unknown): boolean => {\n  if (!isRecord(input)) {\n    return true;',
    to: 'const precheckCompiledBounds = (input: unknown): boolean => {\n  if (!isRecord(input)) {\n    return false;',
  },
] as const)('rejects $name', async ({ path, code, from, to }) => {
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
    'src/transition/validate-compiled-internally.ts',
    '  const graph = canonicalCoreGraph(pipeline);',
    '  const graph = canonicalCoreGraph(unresolvedPipeline);',
  );
  expect(validateGraphKernelFlow(root)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
        path: 'src/transition/validate-compiled-internally.ts',
      }),
    ]),
  );
});

test('fails closed when a tracked path is renamed', async () => {
  expect.hasAssertions();
  const root = await fixture();
  await rename(
    join(root, 'src/transition/validate-compiled-internally.ts'),
    join(root, 'src/transition/renamed-validator.ts'),
  );
  expectViolation(
    root,
    'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
    'src/transition/validate-compiled-internally.ts',
  );
});
