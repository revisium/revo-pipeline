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
    name: 'third builder call site',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: 'const kernelBuild = buildGraphKernel({',
    to: 'const unusedBuild = buildGraphKernel({ nodeKeys: [], edges: [] });\n  void unusedBuild;\n  const kernelBuild = buildGraphKernel({',
  },
  {
    name: 'builder call in decidePipeline',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_BUILD_SITE',
    from: '  const compiled = validateCompiledInternally(pipelineInput);',
    to: '  const forbidden = buildGraphKernel({ nodeKeys: [], edges: [] });\n  void forbidden;\n  const compiled = validateCompiledInternally(pipelineInput);',
  },
  {
    name: 'builder call in evaluator',
    path: 'src/transition/decide-pipeline.ts',
    code: 'GRAPH_KERNEL_BUILD_SITE',
    from: '): EvaluationIndex => {\n  const regionOwnerByNode',
    to: '): EvaluationIndex => {\n  const forbidden = buildGraphKernel({ nodeKeys: [], edges: [] });\n  void forbidden;\n  const regionOwnerByNode',
  },
  {
    name: 'builder alias then call',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_BUILD_SITE',
    from: '  const kernelBuild = buildGraphKernel({',
    to: '  const builder = buildGraphKernel;\n  const kernelBuild = builder({',
  },
  {
    name: 'builder passed as an argument',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_BUILD_SITE',
    from: '  const kernelBuild = buildGraphKernel({',
    to: '  void Promise.resolve(buildGraphKernel);\n  const kernelBuild = buildGraphKernel({',
  },
  {
    name: 'builder call inside a loop',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_BUILD_REPEAT',
    from:
      '  const kernelBuild = buildGraphKernel({\n' +
      '    nodeKeys,\n' +
      '    edges: inducedEdges,\n' +
      '  });',
    to:
      '  const kernelBuild = [0].map(() => buildGraphKernel({\n' +
      '    nodeKeys,\n' +
      '    edges: inducedEdges,\n' +
      '  }))[0]!;',
  },
  {
    name: 'builder call inside a deferred retry closure',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_BUILD_REPEAT',
    from:
      '  const kernelBuild = buildGraphKernel({\n' +
      '    nodeKeys,\n' +
      '    edges: inducedEdges,\n' +
      '  });',
    to:
      '  const kernelBuild = (() => buildGraphKernel({\n' +
      '    nodeKeys,\n' +
      '    edges: inducedEdges,\n' +
      '  }))();',
  },
  {
    name: 'builder call inside a recursive path',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_BUILD_REPEAT',
    from:
      '  const kernelBuild = buildGraphKernel({\n' +
      '    nodeKeys,\n' +
      '    edges: inducedEdges,\n' +
      '  });',
    to:
      '  const recurse = (): ReturnType<typeof buildGraphKernel> => buildGraphKernel({\n' +
      '    nodeKeys,\n' +
      '    edges: inducedEdges,\n' +
      '  });\n' +
      '  const kernelBuild = recurse();',
  },
  {
    name: 'compiler builder before portable dominance',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: 'inspectPortableValueSet(definition,',
    to: 'inspectDefinition(definition,',
  },
  {
    name: 'compiler prerequisite is conditionally bypassed',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
    to: '  if (value.entry) {\n    validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);\n  }',
  },
  {
    name: 'compiler prerequisite is switch-controlled',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
    to: '  switch (value.entry) {\n    default:\n      validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);\n  }',
  },
  {
    name: 'compiler prerequisite is loop-controlled',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
    to: '  for (const once of [true]) {\n    void once;\n    validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);\n  }',
  },
  {
    name: 'compiler prerequisite is try-controlled',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
    to: '  try {\n    validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);\n  } finally {\n    void 0;\n  }',
  },
  {
    name: 'compiler prerequisite is callback-controlled',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
    to: '  [true].forEach(() => validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults));',
  },
  {
    name: 'compiler prerequisite is hidden behind logical and',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
    to: '  value.entry && validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
  },
  {
    name: 'compiler prerequisite is hidden behind logical or',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
    to: '  value.entry || validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
  },
  {
    name: 'compiler prerequisite is hidden behind nullish coalescing',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
    to: '  value.entry ?? validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
  },
  {
    name: 'compiler prerequisite is hidden in a ternary',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);',
    to: '  value.entry ? validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults) : undefined;',
  },
  {
    name: 'compiler structural preflight is bypassed',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const preflight = preflightForkRegions(copiedNodes, nodeKeys, sourceIndexes, sourceNodes, faults);',
    to: '  const preflight = value.entry ? preflightForkRegions(copiedNodes, nodeKeys, sourceIndexes, sourceNodes, faults) : undefined;',
  },
  {
    name: 'compiler node keys use a noncanonical node map',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const nodeKeys = copiedNodes.map((node) => node.key);',
    to: '  const nodeKeys = derivableNodes.map((record) => record.node.key);',
  },
  {
    name: 'compiler induced edges come from an unproven helper',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const inducedEdges = Object.freeze(induced.map(({ semantic }) => semantic));',
    to: '  const inducedEdges = unprovenTopology(induced);',
  },
  {
    name: 'compiler induced graph omits the exact known-endpoint filter',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '    knownKeys.has(edge.from) && knownKeys.has(edge.to)',
    to: '    true',
  },
  {
    name: 'compiler retains legacy adjacency construction',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const preflight = preflightForkRegions(',
    to: '  void buildEdgeBuckets;\n  const preflight = preflightForkRegions(',
  },
  {
    name: 'compiler retains legacy per-branch traversal',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_REBUILD',
    from: '  const preflight = preflightForkRegions(',
    to: '  void collectSemanticRegionMembers;\n  const preflight = preflightForkRegions(',
  },
  {
    name: 'compiler mutates an endpoint after classification',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const entry = typeof value.entry ===',
    to: "  edges[0]!.from = 'tampered';\n  const entry = typeof value.entry ===",
  },
  {
    name: 'compiler mutates induced topology after proof',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  const kernelBuild = buildGraphKernel({',
    to: "  inducedEdges.push({ from: 'a', to: 'b' });\n  const kernelBuild = buildGraphKernel({",
  },
  {
    name: 'compiler swaps the proven builder input',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '    edges: inducedEdges,\n  });',
    to: '    edges,\n  });',
  },
  {
    name: 'compiler suppresses the safe induced diagnostic path',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_TRUST_DOMINANCE',
    from: '  const kernelBuild = buildGraphKernel({',
    to: '  if (faults.length > 0) {\n    return { ok: false, faults: orderedFaults(faults) };\n  }\n  const kernelBuild = buildGraphKernel({',
  },
  {
    name: 'compiler neutralizes the final offset guard',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '  if (!edgeOffsetsAreIdentical) {',
    to: '  if (edgeOffsetsAreIdentical) {',
  },
  {
    name: 'compiler removes semantic-offset identity',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        inducedSemanticOffsets[offset] === offset &&',
    to: '        true &&',
  },
  {
    name: 'compiler inverts semantic-offset identity',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        inducedSemanticOffsets[offset] === offset &&',
    to: '        inducedSemanticOffsets[offset] !== offset &&',
  },
  {
    name: 'compiler removes from identity',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        inducedEdges[offset]?.from === edge.from &&',
    to: '        true &&',
  },
  {
    name: 'compiler inverts from identity',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        inducedEdges[offset]?.from === edge.from &&',
    to: '        inducedEdges[offset]?.from !== edge.from &&',
  },
  {
    name: 'compiler removes outcome identity',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        inducedEdges[offset]?.outcome === edge.outcome &&',
    to: '        true &&',
  },
  {
    name: 'compiler inverts outcome identity',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        inducedEdges[offset]?.outcome === edge.outcome &&',
    to: '        inducedEdges[offset]?.outcome !== edge.outcome &&',
  },
  {
    name: 'compiler removes to identity',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        inducedEdges[offset]?.to === edge.to,',
    to: '        true,',
  },
  {
    name: 'compiler inverts to identity',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '        inducedEdges[offset]?.to === edge.to,',
    to: '        inducedEdges[offset]?.to !== edge.to,',
  },
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
    name: 'compiler edge projection helper changes outside owner digests',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: 'const edgesForNode = (node: PipelineNode): CompiledEdge[] => {',
    to: 'const edgesForNode = (node: PipelineNode): CompiledEdge[] => {\n  void node;',
  },
  {
    name: 'compiler readiness helper changes outside owner digests',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_INPUT_PROVENANCE',
    from: '): void => {\n  const exit = nodeByKey.get(branch.branch.exit);',
    to: '): void => {\n  void edges;\n  const exit = nodeByKey.get(branch.branch.exit);',
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
  {
    name: 'ambiguous tracked import alias',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
    from: '  buildGraphKernel,',
    to: '  buildGraphKernel as makeKernel,',
  },
  {
    name: 'tracked import does not resolve',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
    from: "} from '../graph/index.js';",
    to: "} from '../graph/missing.js';",
  },
  {
    name: 'computed builder lookup',
    path: 'src/definition/compile-pipeline.ts',
    code: 'GRAPH_KERNEL_ANALYSIS_UNPROVEN',
    from: '  const kernelBuild = buildGraphKernel({',
    to: "  void graph['buildGraphKernel'];\n  const kernelBuild = buildGraphKernel({",
  },
] as const)('rejects $name', async ({ path, code, from, to }) => {
  expect.hasAssertions();
  const root = await fixture();
  await replace(root, path, from, to);
  expectViolation(root, code, path);
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
