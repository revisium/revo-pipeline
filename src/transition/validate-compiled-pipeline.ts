import { nodesLeadingToTerminals, reachableNodeKeys, topologicalSort } from '../graph/index.js';
import {
  compareUnicodeCodePoints,
  inspectPortableValue,
  isValidKey,
  isValidSemanticName,
  PIPELINE_LIMITS,
} from '../policy/index.js';
import type {
  CompiledEdge,
  CompiledPipeline,
  FactDefinition,
  JsonScalar,
  PipelineNode,
} from '../spec/index.js';

type ValidationResult =
  | { readonly ok: true; readonly pipeline: CompiledPipeline }
  | { readonly ok: false };

const ROOT_FIELDS = [
  'edges',
  'entry',
  'facts',
  'forkRegions',
  'incomingIndex',
  'nodeIndex',
  'nodes',
  'outgoingIndex',
  'schemaVersion',
  'topologicalOrder',
] as const;

const dataValue = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};

const precheckNestedBounds = (nodes: readonly unknown[]): boolean => {
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = dataValue(nodes, String(nodeIndex));
    if (!isRecord(node)) {
      continue;
    }
    const cases = dataValue(node, 'cases');
    if (!Array.isArray(cases)) {
      continue;
    }
    if (cases.length > PIPELINE_LIMITS.definition.branchCasesPerNode) {
      return false;
    }
    for (let caseIndex = 0; caseIndex < cases.length; caseIndex += 1) {
      const entry = dataValue(cases, String(caseIndex));
      if (!isRecord(entry)) {
        continue;
      }
      const when = dataValue(entry, 'when');
      if (!isRecord(when)) {
        continue;
      }
      const values = dataValue(when, 'values');
      if (
        Array.isArray(values) &&
        values.length > PIPELINE_LIMITS.definition.predicateValuesPerCase
      ) {
        return false;
      }
    }
  }
  return true;
};

const precheckIndexOffsets = (entries: readonly unknown[]): boolean => {
  for (let index = 0; index < entries.length; index += 1) {
    const entry = dataValue(entries, String(index));
    if (!isRecord(entry)) {
      continue;
    }
    const offsets = dataValue(entry, 'edges');
    if (Array.isArray(offsets) && offsets.length > PIPELINE_LIMITS.definition.edges) {
      return false;
    }
  }
  return true;
};

const precheckCompiledBounds = (input: unknown): boolean => {
  if (!isRecord(input)) {
    return true;
  }
  const nodes = dataValue(input, 'nodes');
  const edges = dataValue(input, 'edges');
  const facts = dataValue(input, 'facts');
  const topologicalOrder = dataValue(input, 'topologicalOrder');
  const forkRegions = dataValue(input, 'forkRegions');
  const nodeIndex = dataValue(input, 'nodeIndex');
  const incomingIndex = dataValue(input, 'incomingIndex');
  const outgoingIndex = dataValue(input, 'outgoingIndex');
  const bounds: readonly [unknown, number][] = [
    [nodes, PIPELINE_LIMITS.definition.nodes],
    [edges, PIPELINE_LIMITS.definition.edges],
    [facts, PIPELINE_LIMITS.definition.declaredFacts],
    [topologicalOrder, PIPELINE_LIMITS.definition.nodes],
    [forkRegions, PIPELINE_LIMITS.definition.nodes],
    [nodeIndex, PIPELINE_LIMITS.definition.nodes],
    [incomingIndex, PIPELINE_LIMITS.definition.nodes],
    [outgoingIndex, PIPELINE_LIMITS.definition.nodes],
  ];
  if (bounds.some(([value, maximum]) => Array.isArray(value) && value.length > maximum)) {
    return false;
  }
  return (
    (!Array.isArray(nodes) || precheckNestedBounds(nodes)) &&
    (!Array.isArray(incomingIndex) || precheckIndexOffsets(incomingIndex)) &&
    (!Array.isArray(outgoingIndex) || precheckIndexOffsets(outgoingIndex))
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const keys = Object.keys(value).sort(compareUnicodeCodePoints);
  return (
    keys.length === fields.length &&
    keys.every((key, index) => key === [...fields].sort(compareUnicodeCodePoints)[index])
  );
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');

const isJsonScalar = (value: unknown): boolean =>
  value === null ||
  typeof value === 'boolean' ||
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isSafeInteger(value));

const scalarType = (value: JsonScalar): FactDefinition['type'] => {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  return typeof value === 'number' ? 'number' : 'string';
};

const scalarComparator = (left: JsonScalar, right: JsonScalar): number => {
  const ranks = { null: 0, boolean: 1, number: 2, string: 3 } as const;
  const leftType = scalarType(left);
  const rightType = scalarType(right);
  if (leftType !== rightType) {
    return ranks[leftType] - ranks[rightType];
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return typeof left === 'string' && typeof right === 'string'
    ? compareUnicodeCodePoints(left, right)
    : 0;
};

const scalarIdentity = (value: JsonScalar): string =>
  value === null ? 'null:' : `${typeof value}:${String(value)}`;

const isCanonicalDisplayString = (value: unknown): value is string =>
  typeof value === 'string' &&
  value === value.normalize('NFC') &&
  Array.from(value).length <= PIPELINE_LIMITS.portable.displayCodePoints;

const equalsCanonicalPortableValue = (input: unknown, canonical: unknown): boolean => {
  if (typeof input === 'number' && typeof canonical === 'number') {
    return Object.is(input, canonical);
  }
  if (input === null || typeof input !== 'object') {
    return input === canonical;
  }
  if (
    canonical === null ||
    typeof canonical !== 'object' ||
    Array.isArray(input) !== Array.isArray(canonical)
  ) {
    return false;
  }
  const inputKeys = Object.keys(input).sort(compareUnicodeCodePoints);
  const canonicalKeys = Object.keys(canonical).sort(compareUnicodeCodePoints);
  return (
    inputKeys.length === canonicalKeys.length &&
    inputKeys.every((key, index) => {
      if (key !== canonicalKeys[index]) {
        return false;
      }
      const inputDescriptor = Object.getOwnPropertyDescriptor(input, key);
      const canonicalDescriptor = Object.getOwnPropertyDescriptor(canonical, key);
      return (
        inputDescriptor !== undefined &&
        canonicalDescriptor !== undefined &&
        'value' in inputDescriptor &&
        'value' in canonicalDescriptor &&
        equalsCanonicalPortableValue(inputDescriptor.value, canonicalDescriptor.value)
      );
    })
  );
};

const isCompiledPipelineShape = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & CompiledPipeline =>
  value.schemaVersion === 1 &&
  typeof value.entry === 'string' &&
  Array.isArray(value.nodes) &&
  Array.isArray(value.edges) &&
  Array.isArray(value.facts) &&
  Array.isArray(value.topologicalOrder) &&
  Array.isArray(value.forkRegions) &&
  Array.isArray(value.nodeIndex) &&
  Array.isArray(value.incomingIndex) &&
  Array.isArray(value.outgoingIndex);

const hasSafeIntegerArray = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.every((entry) => Number.isSafeInteger(entry) && entry >= 0);

const membersHaveShape = (pipeline: CompiledPipeline): boolean =>
  pipeline.facts.every(
    (fact) =>
      isRecord(fact) &&
      hasExactFields(fact, ['key', 'type']) &&
      isValidKey(fact.key) &&
      ['boolean', 'number', 'string', 'null'].includes(fact.type),
  ) &&
  pipeline.edges.every(
    (edge) =>
      isRecord(edge) &&
      hasExactFields(edge, ['branch', 'fork', 'from', 'outcome', 'role', 'to']) &&
      isValidKey(edge.from) &&
      isValidSemanticName(edge.outcome) &&
      isValidKey(edge.to) &&
      edge.role === 'activation' &&
      edge.fork === null &&
      edge.branch === null,
  ) &&
  pipeline.topologicalOrder.every((key) => typeof key === 'string') &&
  pipeline.nodeIndex.every(
    (entry) =>
      isRecord(entry) &&
      hasExactFields(entry, ['key', 'node']) &&
      isValidKey(entry.key) &&
      Number.isSafeInteger(entry.node) &&
      entry.node >= 0,
  ) &&
  [...pipeline.incomingIndex, ...pipeline.outgoingIndex].every(
    (entry) =>
      isRecord(entry) &&
      hasExactFields(entry, ['edges', 'key']) &&
      isValidKey(entry.key) &&
      hasSafeIntegerArray(entry.edges),
  );

const isCoreNode = (value: unknown): value is PipelineNode => {
  if (!isRecord(value) || !isValidKey(value.key) || typeof value.kind !== 'string') {
    return false;
  }
  if (value.kind === 'task') {
    return (
      hasExactFields(value, ['key', 'kind', 'outcomes']) &&
      isStringRecord(value.outcomes) &&
      hasExactFields(value.outcomes, ['cancelled', 'completed', 'failed', 'skipped']) &&
      Object.values(value.outcomes).every(isValidKey)
    );
  }
  if (value.kind === 'terminal') {
    return (
      hasExactFields(value, ['key', 'kind', 'outcome']) && isCanonicalDisplayString(value.outcome)
    );
  }
  if (
    value.kind !== 'branch' ||
    !hasExactFields(value, ['cases', 'default', 'fact', 'key', 'kind']) ||
    !isValidKey(value.fact) ||
    !Array.isArray(value.cases)
  ) {
    return false;
  }
  return (
    (value.default === null ||
      (isRecord(value.default) &&
        hasExactFields(value.default, ['name', 'to']) &&
        isValidSemanticName(value.default.name) &&
        isValidKey(value.default.to))) &&
    value.cases.every(
      (entry) =>
        isRecord(entry) &&
        hasExactFields(entry, ['name', 'to', 'when']) &&
        isValidSemanticName(entry.name) &&
        isValidKey(entry.to) &&
        isRecord(entry.when) &&
        ((entry.when.op === 'equals' &&
          hasExactFields(entry.when, ['op', 'value']) &&
          isJsonScalar(entry.when.value)) ||
          (entry.when.op === 'oneOf' &&
            hasExactFields(entry.when, ['op', 'values']) &&
            Array.isArray(entry.when.values) &&
            entry.when.values.every(isJsonScalar))),
    )
  );
};

const branchIntegrity = (
  node: Extract<PipelineNode, { readonly kind: 'branch' }>,
  facts: ReadonlyMap<string, FactDefinition['type']>,
): boolean => {
  const factType = facts.get(node.fact);
  if (factType === undefined || node.cases.length > PIPELINE_LIMITS.definition.branchCasesPerNode) {
    return false;
  }
  const domains: JsonScalar[] = [];
  const domainIdentities = new Set<string>();
  const names = new Set<string>();
  let previous: (typeof node.cases)[number] | undefined;
  for (const entry of node.cases) {
    if (
      names.has(entry.name) ||
      (previous !== undefined &&
        (compareUnicodeCodePoints(previous.name, entry.name) > 0 ||
          (previous.name === entry.name && compareUnicodeCodePoints(previous.to, entry.to) >= 0)))
    ) {
      return false;
    }
    names.add(entry.name);
    previous = entry;
    const values = entry.when.op === 'equals' ? [entry.when.value] : entry.when.values;
    const identities = values.map(scalarIdentity);
    if (
      values.length === 0 ||
      values.length > PIPELINE_LIMITS.definition.predicateValuesPerCase ||
      values.some((value) => scalarType(value) !== factType) ||
      new Set(identities).size !== identities.length ||
      identities.some((identity) => domainIdentities.has(identity)) ||
      (entry.when.op === 'oneOf' &&
        values.some(
          (value, index) => index > 0 && scalarComparator(values[index - 1]!, value) >= 0,
        ))
    ) {
      return false;
    }
    domains.push(...values);
    identities.forEach((identity) => domainIdentities.add(identity));
  }
  if (node.default !== null && names.has(node.default.name)) {
    return false;
  }
  const fullyCovered =
    (factType === 'null' && domains.includes(null)) ||
    (factType === 'boolean' && domains.includes(true) && domains.includes(false));
  return fullyCovered ? node.default === null : node.default !== null;
};

const edgeComparator = (left: CompiledEdge, right: CompiledEdge): number =>
  compareUnicodeCodePoints(left.from, right.from) ||
  compareUnicodeCodePoints(left.outcome, right.outcome) ||
  compareUnicodeCodePoints(left.to, right.to) ||
  compareUnicodeCodePoints(left.role, right.role) ||
  compareUnicodeCodePoints(left.fork ?? '', right.fork ?? '') ||
  compareUnicodeCodePoints(left.branch ?? '', right.branch ?? '');

const edgeFor = (from: string, outcome: string, to: string): CompiledEdge => ({
  from,
  outcome,
  to,
  role: 'activation',
  fork: null,
  branch: null,
});

const edgesEqual = (left: CompiledEdge, right: CompiledEdge): boolean =>
  left.from === right.from &&
  left.outcome === right.outcome &&
  left.to === right.to &&
  left.role === right.role &&
  left.fork === right.fork &&
  left.branch === right.branch;

const expectedEdgesForNode = (node: PipelineNode): readonly CompiledEdge[] | undefined => {
  if (node.kind === 'task') {
    return Object.entries(node.outcomes).map(([outcome, to]) => edgeFor(node.key, outcome, to));
  }
  if (node.kind === 'branch') {
    return [
      ...node.cases.map((entry) => edgeFor(node.key, entry.name, entry.to)),
      ...(node.default ? [edgeFor(node.key, node.default.name, node.default.to)] : []),
    ];
  }
  if (node.kind === 'terminal') {
    return [];
  }
  return undefined;
};

const indexesAreCanonical = (
  pipeline: CompiledPipeline,
  direction: 'incoming' | 'outgoing',
): boolean => {
  const index = direction === 'incoming' ? pipeline.incomingIndex : pipeline.outgoingIndex;
  if (index.length !== pipeline.nodes.length) {
    return false;
  }
  const expected = new Map(pipeline.nodes.map((node) => [node.key, [] as number[]]));
  pipeline.edges.forEach((edge, offset) => {
    expected.get(direction === 'incoming' ? edge.to : edge.from)?.push(offset);
  });
  return pipeline.nodes.every((node, nodeOffset) => {
    const entry = index[nodeOffset];
    const offsets = expected.get(node.key) ?? [];
    return (
      entry?.key === node.key &&
      entry.edges.length === offsets.length &&
      entry.edges.every((offset, indexOffset) => offset === offsets[indexOffset])
    );
  });
};

const arraysAreBounded = (pipeline: CompiledPipeline): boolean =>
  pipeline.nodes.length <= PIPELINE_LIMITS.definition.nodes &&
  pipeline.edges.length <= PIPELINE_LIMITS.definition.edges &&
  pipeline.facts.length <= PIPELINE_LIMITS.definition.declaredFacts;

const canonicalCoreGraph = (pipeline: CompiledPipeline): boolean => {
  const expectedEdges: CompiledEdge[] = [];
  const facts = new Map(pipeline.facts.map((fact) => [fact.key, fact.type]));
  for (const node of pipeline.nodes) {
    if (!isCoreNode(node)) {
      return false;
    }
    if (node.kind === 'branch' && !branchIntegrity(node, facts)) {
      return false;
    }
    const nodeEdges = expectedEdgesForNode(node);
    if (!nodeEdges) {
      return false;
    }
    expectedEdges.push(...nodeEdges);
  }
  expectedEdges.sort(edgeComparator);
  const nodeKeys = new Set(pipeline.nodes.map((node) => node.key));
  if (pipeline.edges.some((edge) => !nodeKeys.has(edge.from) || !nodeKeys.has(edge.to))) {
    return false;
  }
  const expectedOrder = topologicalSort(
    pipeline.nodes.map((node) => node.key),
    expectedEdges,
  );
  return (
    pipeline.edges.length === expectedEdges.length &&
    pipeline.edges.every((edge, index) => {
      const expected = expectedEdges[index];
      return expected !== undefined && edgesEqual(edge, expected);
    }) &&
    expectedOrder !== null &&
    JSON.stringify(pipeline.topologicalOrder) === JSON.stringify(expectedOrder) &&
    pipeline.forkRegions.length === 0 &&
    reachableNodeKeys(pipeline.entry, pipeline.edges).size === pipeline.nodes.length &&
    nodesLeadingToTerminals(
      pipeline.nodes.filter((node) => node.kind === 'terminal').map((node) => node.key),
      pipeline.edges,
    ).size === pipeline.nodes.length
  );
};

const canonicalCollections = (pipeline: CompiledPipeline): boolean => {
  const nodeKeys = pipeline.nodes.map((node) => node.key);
  const factKeys = pipeline.facts.map((fact) => fact.key);
  return (
    nodeKeys.every(
      (key, index) => index === 0 || compareUnicodeCodePoints(nodeKeys[index - 1] ?? '', key) < 0,
    ) &&
    factKeys.every(
      (key, index) => index === 0 || compareUnicodeCodePoints(factKeys[index - 1] ?? '', key) < 0,
    ) &&
    pipeline.nodeIndex.length === pipeline.nodes.length &&
    pipeline.nodeIndex.every(
      (entry, index) => entry.key === nodeKeys[index] && entry.node === index,
    ) &&
    indexesAreCanonical(pipeline, 'incoming') &&
    indexesAreCanonical(pipeline, 'outgoing')
  );
};

export const validateCompiledPipeline = (input: unknown): ValidationResult => {
  if (!precheckCompiledBounds(input)) {
    return { ok: false };
  }
  const inspected = inspectPortableValue(input, {
    maxArrayLength: PIPELINE_LIMITS.facts.total,
    maxStringCodePoints: PIPELINE_LIMITS.portable.displayCodePoints,
  });
  if (
    !inspected.ok ||
    !equalsCanonicalPortableValue(input, inspected.value) ||
    !isRecord(inspected.value) ||
    !hasExactFields(inspected.value, ROOT_FIELDS)
  ) {
    return { ok: false };
  }
  if (!isCompiledPipelineShape(inspected.value)) {
    return { ok: false };
  }
  const pipeline = inspected.value;
  if (
    !arraysAreBounded(pipeline) ||
    !membersHaveShape(pipeline) ||
    !canonicalCollections(pipeline) ||
    !canonicalCoreGraph(pipeline) ||
    !isValidKey(pipeline.entry) ||
    !pipeline.nodes.some((node) => node.key === pipeline.entry)
  ) {
    return { ok: false };
  }
  return { ok: true, pipeline };
};
