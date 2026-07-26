import type { DefinitionFault, DefinitionFaultCode, PipelineCompilation } from '../errors/index.js';
import {
  buildGraphAdjacency,
  collectRegionMembers,
  nodesLeadingToTerminals,
  reachableNodeKeys,
  topologicalSort,
} from '../graph/index.js';
import {
  compareUnicodeCodePoints,
  DEFINITION_FAULT_PHASES,
  escapeJsonPointerSegment,
  inspectPortableValueSet,
  isValidKey,
  isValidSemanticName,
  jsonScalarsEqual,
  normalizeJsonScalar,
  orderFaults,
  PIPELINE_LIMITS,
} from '../policy/index.js';
import type {
  BranchCase,
  CompiledEdge,
  CompiledForkRegion,
  CompiledPipeline,
  FactDefinition,
  JsonScalar,
  PipelineDefinition,
  PipelineNode,
} from '../spec/index.js';

type RecordValue = Record<string, unknown>;
type MutableFault = { code: DefinitionFaultCode; path: string; message: string };
type MutableCompiledEdge = { -readonly [Key in keyof CompiledEdge]: CompiledEdge[Key] };
type ValidatedNode = {
  readonly node: PipelineNode;
  readonly path: string;
  readonly sourceIndex: number;
  readonly uniqueKey: boolean;
};

const TASK_OUTCOMES = ['cancelled', 'completed', 'failed', 'skipped'] as const;
const JOIN_OUTCOMES = ['completed', 'insufficient', 'rejected'] as const;
const CONSENSUS_OUTCOMES = ['approved', 'insufficient', 'rejected', 'tied'] as const;
const NODE_KINDS: ReadonlySet<string> = new Set([
  'branch',
  'consensus',
  'fork',
  'humanGate',
  'join',
  'task',
  'terminal',
]);
const FACT_TYPES: ReadonlySet<string> = new Set(['boolean', 'null', 'number', 'string']);

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFactType = (value: unknown): value is FactDefinition['type'] =>
  typeof value === 'string' && FACT_TYPES.has(value);

const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');

const isPipelineNode = (value: unknown): value is PipelineNode => {
  if (!isRecord(value) || typeof value.key !== 'string') {
    return false;
  }
  switch (value.kind) {
    case 'task':
      return isStringRecord(value.outcomes);
    case 'branch':
      return (
        typeof value.fact === 'string' &&
        Array.isArray(value.cases) &&
        value.cases.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.name === 'string' &&
            typeof entry.to === 'string' &&
            isRecord(entry.when) &&
            ((entry.when.op === 'equals' && 'value' in entry.when) ||
              (entry.when.op === 'oneOf' && Array.isArray(entry.when.values))),
        ) &&
        (value.default === null ||
          (isRecord(value.default) &&
            typeof value.default.name === 'string' &&
            typeof value.default.to === 'string'))
      );
    case 'fork':
      return (
        typeof value.join === 'string' &&
        Array.isArray(value.branches) &&
        value.branches.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.name === 'string' &&
            typeof entry.entry === 'string' &&
            typeof entry.exit === 'string',
        )
      );
    case 'join':
      return (
        typeof value.fork === 'string' && isRecord(value.policy) && isStringRecord(value.outcomes)
      );
    case 'consensus':
      return (
        Array.isArray(value.candidates) &&
        value.candidates.every((entry) => typeof entry === 'string') &&
        isRecord(value.policy) &&
        isStringRecord(value.outcomes)
      );
    case 'humanGate':
      return (
        typeof value.subject === 'string' &&
        Array.isArray(value.resolutions) &&
        value.resolutions.every(
          (entry) =>
            isRecord(entry) && typeof entry.resolution === 'string' && typeof entry.to === 'string',
        )
      );
    case 'terminal':
      return typeof value.outcome === 'string';
    default:
      return false;
  }
};

const addFault = (
  faults: MutableFault[],
  code: DefinitionFaultCode,
  path: string,
  message: string,
): void => {
  faults.push({ code, path, message });
};

const unknownFields = (
  value: RecordValue,
  allowed: readonly string[],
  path: string,
  faults: MutableFault[],
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      addFault(
        faults,
        'DEF_UNKNOWN_FIELD',
        `${path}/${escapeJsonPointerSegment(key)}`,
        'Unknown field.',
      );
    }
  }
};

const requireKey = (value: unknown, path: string, faults: MutableFault[]): value is string => {
  if (!isValidKey(value)) {
    addFault(faults, 'DEF_KEY', path, 'Invalid key.');
    return false;
  }
  return true;
};

const requireName = (value: unknown, path: string, faults: MutableFault[]): value is string => {
  if (!isValidSemanticName(value)) {
    addFault(faults, 'DEF_KEY', path, 'Invalid semantic name.');
    return false;
  }
  return true;
};

const requireDisplayString = (
  value: unknown,
  path: string,
  faults: MutableFault[],
): value is string => {
  if (
    typeof value !== 'string' ||
    Array.from(value.normalize('NFC')).length > PIPELINE_LIMITS.portable.displayCodePoints
  ) {
    addFault(faults, 'DEF_TYPE', path, 'Expected a bounded string.');
    return false;
  }
  return true;
};

const requireArray = (
  value: unknown,
  path: string,
  maximum: number,
  faults: MutableFault[],
): value is unknown[] => {
  if (!Array.isArray(value)) {
    addFault(faults, 'DEF_TYPE', path, 'Expected an array.');
    return false;
  }
  if (value.length > maximum) {
    addFault(faults, 'DEF_LIMIT', path, 'Collection limit exceeded.');
    return false;
  }
  return true;
};

const validateExactRoutes = (
  value: unknown,
  outcomes: readonly string[],
  path: string,
  faults: MutableFault[],
): value is Record<string, string> => {
  if (!isRecord(value)) {
    addFault(faults, 'DEF_TYPE', path, 'Expected route object.');
    return false;
  }
  unknownFields(value, outcomes, path, faults);
  let valid = true;
  for (const outcome of outcomes) {
    if (!requireKey(value[outcome], `${path}/${outcome}`, faults)) {
      valid = false;
    }
  }
  return valid;
};

const scalarType = (value: JsonScalar): string => (value === null ? 'null' : typeof value);
const scalarTypeRank = (value: JsonScalar): number => {
  if (value === null) {
    return 0;
  }
  if (typeof value === 'boolean') {
    return 1;
  }
  return typeof value === 'number' ? 2 : 3;
};
const scalarComparator = (left: JsonScalar, right: JsonScalar): number => {
  const rank = scalarTypeRank(left) - scalarTypeRank(right);
  if (rank !== 0) {
    return rank;
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return compareUnicodeCodePoints(left, right);
  }
  return 0;
};

const validateScalar = (
  value: unknown,
  path: string,
  faults: MutableFault[],
): value is JsonScalar => {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  ) {
    return true;
  }
  addFault(faults, 'DEF_TYPE', path, 'Expected a JSON scalar.');
  return false;
};

const validatePredicate = (
  value: unknown,
  path: string,
  faults: MutableFault[],
): readonly JsonScalar[] => {
  if (!isRecord(value) || (value.op !== 'equals' && value.op !== 'oneOf')) {
    addFault(faults, 'DEF_TYPE', path, 'Invalid branch predicate.');
    return [];
  }
  if (value.op === 'equals') {
    unknownFields(value, ['op', 'value'], path, faults);
    return validateScalar(value.value, `${path}/value`, faults)
      ? [normalizeJsonScalar(value.value)]
      : [];
  }
  unknownFields(value, ['op', 'values'], path, faults);
  if (
    !requireArray(
      value.values,
      `${path}/values`,
      PIPELINE_LIMITS.definition.predicateValuesPerCase,
      faults,
    )
  ) {
    return [];
  }
  if (value.values.length === 0) {
    addFault(faults, 'DEF_BRANCH_NON_EXHAUSTIVE', `${path}/values`, 'oneOf must be non-empty.');
  }
  const scalars: JsonScalar[] = [];
  value.values.forEach((entry, index) => {
    if (validateScalar(entry, `${path}/values/${index}`, faults)) {
      const normalized = normalizeJsonScalar(entry);
      if (scalars.some((existing) => jsonScalarsEqual(existing, normalized))) {
        addFault(faults, 'DEF_DUPLICATE', `${path}/values/${index}`, 'Duplicate predicate value.');
      }
      scalars.push(normalized);
    }
  });
  return scalars;
};

const validateFacts = (value: unknown, faults: MutableFault[]): readonly FactDefinition[] => {
  if (!requireArray(value, '/facts', PIPELINE_LIMITS.definition.declaredFacts, faults)) {
    return [];
  }
  const facts: FactDefinition[] = [];
  const keys = new Set<string>();
  value.forEach((entry, index) => {
    const path = `/facts/${index}`;
    if (!isRecord(entry)) {
      addFault(faults, 'DEF_TYPE', path, 'Expected fact definition.');
      return;
    }
    unknownFields(entry, ['key', 'type'], path, faults);
    const key = entry.key;
    const type = entry.type;
    const keyValid = requireKey(key, `${path}/key`, faults);
    const typeValid = isFactType(type);
    if (!typeValid) {
      addFault(faults, 'DEF_TYPE', `${path}/type`, 'Invalid fact type.');
    }
    if (keyValid && keys.has(key)) {
      addFault(faults, 'DEF_DUPLICATE', `${path}/key`, 'Duplicate fact key.');
    }
    if (keyValid) {
      keys.add(key);
    }
    if (keyValid && typeValid) {
      facts.push({ key, type });
    }
  });
  return facts;
};

const validateBranchCaseScalars = (
  predicate: unknown,
  casePath: string,
  expectedType: FactDefinition['type'] | undefined,
  domains: JsonScalar[],
  faults: MutableFault[],
): void => {
  const scalars = validatePredicate(predicate, `${casePath}/when`, faults);
  for (const scalar of scalars) {
    if (domains.some((existing) => jsonScalarsEqual(existing, scalar))) {
      addFault(faults, 'DEF_BRANCH_AMBIGUOUS', `${casePath}/when`, 'Overlapping case domain.');
    }
    domains.push(scalar);
    if (expectedType !== undefined && scalarType(scalar) !== expectedType) {
      addFault(faults, 'DEF_TYPE', `${casePath}/when`, 'Predicate type differs from fact.');
    }
  }
};

const validateBranchCase = (
  entry: RecordValue,
  casePath: string,
  expectedType: FactDefinition['type'] | undefined,
  domains: JsonScalar[],
  names: Set<string>,
  faults: MutableFault[],
): void => {
  unknownFields(entry, ['name', 'to', 'when'], casePath, faults);
  if (requireName(entry.name, `${casePath}/name`, faults)) {
    if (names.has(entry.name)) {
      addFault(faults, 'DEF_DUPLICATE', `${casePath}/name`, 'Duplicate branch name.');
    }
    names.add(entry.name);
  }
  requireKey(entry.to, `${casePath}/to`, faults);
  validateBranchCaseScalars(entry.when, casePath, expectedType, domains, faults);
};

const validateBranchCases = (
  cases: readonly unknown[],
  path: string,
  expectedType: FactDefinition['type'] | undefined,
  faults: MutableFault[],
): { readonly domains: readonly JsonScalar[]; readonly names: ReadonlySet<string> } => {
  const domains: JsonScalar[] = [];
  const names = new Set<string>();
  for (const [index, entry] of cases.entries()) {
    const casePath = `${path}/cases/${index}`;
    if (!isRecord(entry)) {
      addFault(faults, 'DEF_TYPE', casePath, 'Expected branch case.');
      continue;
    }
    validateBranchCase(entry, casePath, expectedType, domains, names, faults);
  }
  return { domains, names };
};

const validateBranchDefault = (
  value: unknown,
  path: string,
  caseNames: ReadonlySet<string>,
  faults: MutableFault[],
): void => {
  if (value === null) {
    return;
  }
  if (!isRecord(value)) {
    addFault(faults, 'DEF_TYPE', `${path}/default`, 'Invalid branch default.');
    return;
  }
  unknownFields(value, ['name', 'to'], `${path}/default`, faults);
  const name = value.name;
  const nameValid = requireName(name, `${path}/default/name`, faults);
  const targetValid = nameValid && requireKey(value.to, `${path}/default/to`, faults);
  if (!nameValid || !targetValid) {
    addFault(faults, 'DEF_TYPE', `${path}/default`, 'Invalid branch default.');
  }
  if (nameValid && caseNames.has(name)) {
    addFault(faults, 'DEF_DUPLICATE', `${path}/default/name`, 'Duplicate branch name.');
  }
};

const branchDomainIsFullyCovered = (
  type: FactDefinition['type'] | undefined,
  domains: readonly JsonScalar[],
): boolean => {
  if (type === 'null') {
    return domains.includes(null);
  }
  return type === 'boolean' && domains.includes(true) && domains.includes(false);
};

const validateBranchCoverage = (
  type: FactDefinition['type'] | undefined,
  domains: readonly JsonScalar[],
  hasDefault: boolean,
  path: string,
  faults: MutableFault[],
): void => {
  if ((type === 'string' || type === 'number') && !hasDefault) {
    addFault(faults, 'DEF_BRANCH_NON_EXHAUSTIVE', `${path}/default`, 'Default is required.');
  }
  const fullyCovered = branchDomainIsFullyCovered(type, domains);
  if ((type === 'null' || type === 'boolean') && !fullyCovered && !hasDefault) {
    addFault(faults, 'DEF_BRANCH_NON_EXHAUSTIVE', `${path}/default`, 'Branch is not exhaustive.');
  }
  if (fullyCovered && hasDefault) {
    addFault(
      faults,
      'DEF_BRANCH_UNREACHABLE_DEFAULT',
      `${path}/default`,
      'Default is unreachable.',
    );
  }
};

const validateBranch = (
  node: RecordValue,
  path: string,
  factTypes: ReadonlyMap<string, FactDefinition['type']>,
  faults: MutableFault[],
): void => {
  unknownFields(node, ['cases', 'default', 'fact', 'key', 'kind'], path, faults);
  const fact = node.fact;
  const factValid = requireKey(fact, `${path}/fact`, faults);
  const cases = requireArray(
    node.cases,
    `${path}/cases`,
    PIPELINE_LIMITS.definition.branchCasesPerNode,
    faults,
  )
    ? node.cases
    : [];
  const type = factValid ? factTypes.get(fact) : undefined;
  const { domains, names } = validateBranchCases(cases, path, type, faults);
  validateBranchDefault(node.default, path, names, faults);
  if (factValid && type === undefined) {
    addFault(faults, 'DEF_TARGET', `${path}/fact`, 'Unknown branch fact.');
  }
  validateBranchCoverage(type, domains, node.default !== null, path, faults);
};

const validateFork = (node: RecordValue, path: string, faults: MutableFault[]): void => {
  unknownFields(node, ['branches', 'join', 'key', 'kind'], path, faults);
  requireKey(node.join, `${path}/join`, faults);
  if (
    !requireArray(
      node.branches,
      `${path}/branches`,
      PIPELINE_LIMITS.definition.forkBranchesPerNode,
      faults,
    )
  ) {
    return;
  }
  if (node.branches.length < 2) {
    addFault(faults, 'DEF_FORK_ARITY', `${path}/branches`, 'Fork requires at least two branches.');
  }
  const names = new Set<string>();
  node.branches.forEach((entry, index) => {
    const branchPath = `${path}/branches/${index}`;
    if (!isRecord(entry)) {
      addFault(faults, 'DEF_TYPE', branchPath, 'Expected fork branch.');
      return;
    }
    unknownFields(entry, ['entry', 'exit', 'name'], branchPath, faults);
    if (requireName(entry.name, `${branchPath}/name`, faults)) {
      if (names.has(entry.name)) {
        addFault(faults, 'DEF_DUPLICATE', `${branchPath}/name`, 'Duplicate fork branch.');
      }
      names.add(entry.name);
    }
    requireKey(entry.entry, `${branchPath}/entry`, faults);
    requireKey(entry.exit, `${branchPath}/exit`, faults);
  });
};

const validateJoin = (node: RecordValue, path: string, faults: MutableFault[]): void => {
  unknownFields(node, ['fork', 'key', 'kind', 'outcomes', 'policy'], path, faults);
  requireKey(node.fork, `${path}/fork`, faults);
  validateExactRoutes(node.outcomes, JOIN_OUTCOMES, `${path}/outcomes`, faults);
  if (!isRecord(node.policy) || !['all', 'any', 'threshold'].includes(String(node.policy.kind))) {
    addFault(faults, 'DEF_TYPE', `${path}/policy`, 'Invalid join policy.');
    return;
  }
  if (node.policy.kind === 'all') {
    unknownFields(node.policy, ['kind'], `${path}/policy`, faults);
  } else if (node.policy.kind === 'any') {
    unknownFields(node.policy, ['kind', 'remaining'], `${path}/policy`, faults);
    if (node.policy.remaining !== 'unconstrained') {
      addFault(faults, 'DEF_TYPE', `${path}/policy/remaining`, 'Invalid remaining policy.');
    }
  } else {
    unknownFields(node.policy, ['count', 'kind'], `${path}/policy`, faults);
    if (!Number.isSafeInteger(node.policy.count) || Number(node.policy.count) < 1) {
      addFault(faults, 'DEF_JOIN_THRESHOLD', `${path}/policy/count`, 'Invalid threshold.');
    }
  }
};

const validateConsensus = (node: RecordValue, path: string, faults: MutableFault[]): number => {
  unknownFields(node, ['candidates', 'key', 'kind', 'outcomes', 'policy'], path, faults);
  validateExactRoutes(node.outcomes, CONSENSUS_OUTCOMES, `${path}/outcomes`, faults);
  if (
    !requireArray(
      node.candidates,
      `${path}/candidates`,
      PIPELINE_LIMITS.definition.candidatesPerNode,
      faults,
    )
  ) {
    return 0;
  }
  if (node.candidates.length === 0) {
    addFault(
      faults,
      'DEF_CONSENSUS_CANDIDATE',
      `${path}/candidates`,
      'Candidates must be non-empty.',
    );
  }
  const names = new Set<string>();
  node.candidates.forEach((candidate, index) => {
    if (requireName(candidate, `${path}/candidates/${index}`, faults)) {
      if (names.has(candidate)) {
        addFault(
          faults,
          'DEF_CONSENSUS_CANDIDATE',
          `${path}/candidates/${index}`,
          'Duplicate candidate.',
        );
      }
      names.add(candidate);
    }
  });
  if (
    !isRecord(node.policy) ||
    !['quorum', 'threshold', 'unanimous'].includes(String(node.policy.kind))
  ) {
    addFault(faults, 'DEF_TYPE', `${path}/policy`, 'Invalid consensus policy.');
    return node.candidates.length;
  }
  const count = node.candidates.length;
  if (node.policy.kind === 'unanimous') {
    unknownFields(node.policy, ['kind'], `${path}/policy`, faults);
  } else if (node.policy.kind === 'quorum') {
    unknownFields(node.policy, ['kind', 'quorum'], `${path}/policy`, faults);
    if (
      !Number.isSafeInteger(node.policy.quorum) ||
      Number(node.policy.quorum) < 1 ||
      Number(node.policy.quorum) > count
    ) {
      addFault(faults, 'DEF_CONSENSUS_BOUND', `${path}/policy/quorum`, 'Invalid quorum.');
    }
  } else {
    unknownFields(node.policy, ['approve', 'kind', 'reject'], `${path}/policy`, faults);
    const approve = Number(node.policy.approve);
    const reject = Number(node.policy.reject);
    if (
      !Number.isSafeInteger(node.policy.approve) ||
      !Number.isSafeInteger(node.policy.reject) ||
      approve < 1 ||
      reject < 1 ||
      approve > count ||
      reject > count ||
      approve + reject <= count
    ) {
      addFault(faults, 'DEF_CONSENSUS_BOUND', `${path}/policy`, 'Invalid threshold bounds.');
    }
  }
  return count;
};

const validateGate = (node: RecordValue, path: string, faults: MutableFault[]): number => {
  unknownFields(node, ['key', 'kind', 'resolutions', 'subject'], path, faults);
  requireDisplayString(node.subject, `${path}/subject`, faults);
  if (
    !requireArray(
      node.resolutions,
      `${path}/resolutions`,
      PIPELINE_LIMITS.definition.resolutionsPerNode,
      faults,
    )
  ) {
    return 0;
  }
  if (node.resolutions.length === 0) {
    addFault(
      faults,
      'DEF_GATE_RESOLUTION',
      `${path}/resolutions`,
      'Resolutions must be non-empty.',
    );
  }
  const names = new Set<string>();
  node.resolutions.forEach((entry, index) => {
    const routePath = `${path}/resolutions/${index}`;
    if (!isRecord(entry)) {
      addFault(faults, 'DEF_TYPE', routePath, 'Expected gate resolution.');
      return;
    }
    unknownFields(entry, ['resolution', 'to'], routePath, faults);
    if (requireName(entry.resolution, `${routePath}/resolution`, faults)) {
      if (names.has(entry.resolution)) {
        addFault(faults, 'DEF_GATE_RESOLUTION', `${routePath}/resolution`, 'Duplicate resolution.');
      }
      names.add(entry.resolution);
    }
    requireKey(entry.to, `${routePath}/to`, faults);
  });
  return node.resolutions.length;
};

const validateNodes = (
  value: unknown,
  facts: readonly FactDefinition[],
  faults: MutableFault[],
): readonly ValidatedNode[] => {
  if (!requireArray(value, '/nodes', PIPELINE_LIMITS.definition.nodes, faults)) {
    return [];
  }
  const nodes: ValidatedNode[] = [];
  const keys = new Set<string>();
  const factTypes = new Map(facts.map((fact) => [fact.key, fact.type]));
  let candidateTotal = 0;
  let resolutionTotal = 0;
  value.forEach((entry, index) => {
    const path = `/nodes/${index}`;
    if (!isRecord(entry)) {
      addFault(faults, 'DEF_TYPE', path, 'Expected pipeline node.');
      return;
    }
    const kindValid = typeof entry.kind === 'string' && NODE_KINDS.has(entry.kind);
    if (!kindValid) {
      addFault(faults, 'DEF_TYPE', `${path}/kind`, 'Invalid node kind.');
    }
    const key = entry.key;
    const keyValid = requireKey(key, `${path}/key`, faults);
    const uniqueKey = keyValid && !keys.has(key);
    if (keyValid && !uniqueKey) {
      addFault(faults, 'DEF_DUPLICATE', `${path}/key`, 'Duplicate node key.');
    }
    if (keyValid) {
      keys.add(key);
    }
    switch (entry.kind) {
      case 'task':
        unknownFields(entry, ['key', 'kind', 'outcomes'], path, faults);
        validateExactRoutes(entry.outcomes, TASK_OUTCOMES, `${path}/outcomes`, faults);
        break;
      case 'branch':
        validateBranch(entry, path, factTypes, faults);
        break;
      case 'fork':
        validateFork(entry, path, faults);
        break;
      case 'join':
        validateJoin(entry, path, faults);
        break;
      case 'consensus':
        candidateTotal += validateConsensus(entry, path, faults);
        break;
      case 'humanGate':
        resolutionTotal += validateGate(entry, path, faults);
        break;
      case 'terminal':
        unknownFields(entry, ['key', 'kind', 'outcome'], path, faults);
        requireDisplayString(entry.outcome, `${path}/outcome`, faults);
        break;
    }
    if (kindValid && keyValid && isPipelineNode(entry)) {
      nodes.push({ node: entry, path, sourceIndex: index, uniqueKey });
    }
  });
  if (candidateTotal > PIPELINE_LIMITS.definition.candidatesTotal) {
    addFault(faults, 'DEF_LIMIT', '/nodes', 'Candidate total exceeded.');
  }
  if (resolutionTotal > PIPELINE_LIMITS.definition.resolutionsTotal) {
    addFault(faults, 'DEF_LIMIT', '/nodes', 'Resolution total exceeded.');
  }
  return nodes;
};

const normalizeCase = (entry: BranchCase): BranchCase => ({
  name: entry.name,
  to: entry.to,
  when:
    entry.when.op === 'equals'
      ? { op: 'equals', value: normalizeJsonScalar(entry.when.value) }
      : {
          op: 'oneOf',
          values: entry.when.values.map(normalizeJsonScalar).sort(scalarComparator),
        },
});

const copyNode = (node: PipelineNode): PipelineNode => {
  switch (node.kind) {
    case 'task':
      return { kind: 'task', key: node.key, outcomes: { ...node.outcomes } };
    case 'branch':
      return {
        kind: 'branch',
        key: node.key,
        fact: node.fact,
        cases: node.cases
          .map(normalizeCase)
          .sort(
            (left, right) =>
              compareUnicodeCodePoints(left.name, right.name) ||
              compareUnicodeCodePoints(left.to, right.to),
          ),
        default: node.default ? { ...node.default } : null,
      };
    case 'fork':
      return {
        kind: 'fork',
        key: node.key,
        join: node.join,
        branches: node.branches
          .map((branch) => ({ ...branch }))
          .sort(
            (left, right) =>
              compareUnicodeCodePoints(left.name, right.name) ||
              compareUnicodeCodePoints(left.entry, right.entry),
          ),
      };
    case 'join':
      return {
        kind: 'join',
        key: node.key,
        fork: node.fork,
        policy: { ...node.policy },
        outcomes: { ...node.outcomes },
      };
    case 'consensus':
      return {
        kind: 'consensus',
        key: node.key,
        candidates: [...node.candidates].sort(compareUnicodeCodePoints),
        policy: { ...node.policy },
        outcomes: { ...node.outcomes },
      };
    case 'humanGate':
      return {
        kind: 'humanGate',
        key: node.key,
        subject: node.subject.normalize('NFC'),
        resolutions: node.resolutions
          .map((resolution) => ({ ...resolution }))
          .sort(
            (left, right) =>
              compareUnicodeCodePoints(left.resolution, right.resolution) ||
              compareUnicodeCodePoints(left.to, right.to),
          ),
      };
    case 'terminal':
      return { kind: 'terminal', key: node.key, outcome: node.outcome.normalize('NFC') };
  }
  throw new Error('Unsupported pipeline node.');
};

const edgesForNode = (node: PipelineNode): CompiledEdge[] => {
  const edge = (outcome: string, to: string): CompiledEdge => ({
    from: node.key,
    outcome,
    to,
    role: 'activation',
    fork: null,
    branch: null,
  });
  switch (node.kind) {
    case 'task':
    case 'join':
    case 'consensus':
      return Object.entries(node.outcomes).map(([outcome, to]) => edge(outcome, to));
    case 'branch':
      return [
        ...node.cases.map((entry) => edge(entry.name, entry.to)),
        ...(node.default ? [edge(node.default.name, node.default.to)] : []),
      ];
    case 'fork':
      return [
        ...node.branches.map((branch) => ({
          ...edge('forked', branch.entry),
          fork: node.key,
          branch: branch.name,
        })),
        { ...edge('forked', node.join), fork: node.key },
      ];
    case 'humanGate':
      return node.resolutions.map((entry) => edge(entry.resolution, entry.to));
    case 'terminal':
      return [];
  }
  throw new Error('Unsupported pipeline node.');
};

const edgeComparator = (left: CompiledEdge, right: CompiledEdge): number =>
  compareUnicodeCodePoints(left.from, right.from) ||
  compareUnicodeCodePoints(left.outcome, right.outcome) ||
  compareUnicodeCodePoints(left.to, right.to) ||
  compareUnicodeCodePoints(left.role, right.role) ||
  compareUnicodeCodePoints(left.fork ?? '', right.fork ?? '') ||
  compareUnicodeCodePoints(left.branch ?? '', right.branch ?? '');

const validateReferences = (
  entry: unknown,
  nodes: readonly PipelineNode[],
  edges: readonly CompiledEdge[],
  sourceIndexes: ReadonlyMap<string, number>,
  faults: MutableFault[],
): void => {
  const keys = new Set(nodes.map((node) => node.key));
  if (!requireKey(entry, '/entry', faults) || !keys.has(entry)) {
    addFault(faults, 'DEF_ENTRY', '/entry', 'Entry must reference a node.');
  }
  for (const edge of edges) {
    if (!keys.has(edge.to)) {
      addFault(
        faults,
        'DEF_TARGET',
        `/nodes/${sourceIndexes.get(edge.from) ?? 0}`,
        `Unknown target ${edge.to}.`,
      );
    }
  }
  if (edges.length > PIPELINE_LIMITS.definition.edges) {
    addFault(faults, 'DEF_LIMIT', '/nodes', 'Edge limit exceeded.');
  }
};

type EdgeBuckets = {
  readonly incoming: ReadonlyMap<string, readonly MutableCompiledEdge[]>;
  readonly outgoing: ReadonlyMap<string, readonly MutableCompiledEdge[]>;
};

type RegionContext = {
  readonly adjacency: ReturnType<typeof buildGraphAdjacency>;
  readonly buckets: EdgeBuckets;
  readonly nodeByKey: ReadonlyMap<string, PipelineNode>;
  readonly sourceIndexes: ReadonlyMap<string, number>;
  readonly sourceNodes: ReadonlyMap<string, PipelineNode>;
};

type ForkNode = Extract<PipelineNode, { readonly kind: 'fork' }>;
type JoinNode = Extract<PipelineNode, { readonly kind: 'join' }>;
type ForkBranchClassification = {
  readonly branch: ForkNode['branches'][number];
  readonly branchExits: Map<string, string>;
  readonly context: RegionContext;
  readonly faults: MutableFault[];
  readonly fork: ForkNode;
  readonly forkPath: string;
  readonly join: JoinNode;
  readonly memberOwners: Map<string, string>;
};

const buildEdgeBuckets = (edges: readonly MutableCompiledEdge[]): EdgeBuckets => {
  const outgoing = new Map<string, MutableCompiledEdge[]>();
  const incoming = new Map<string, MutableCompiledEdge[]>();
  for (const edge of edges) {
    const outgoingForNode = outgoing.get(edge.from) ?? [];
    outgoingForNode.push(edge);
    outgoing.set(edge.from, outgoingForNode);
    const incomingForNode = incoming.get(edge.to) ?? [];
    incomingForNode.push(edge);
    incoming.set(edge.to, incomingForNode);
  }
  return { incoming, outgoing };
};

const sourceBranchIndex = (
  fork: ForkNode,
  branch: (typeof fork.branches)[number],
  sourceNodes: ReadonlyMap<string, PipelineNode>,
): number => {
  const sourceFork = sourceNodes.get(fork.key);
  if (sourceFork?.kind !== 'fork') {
    return 0;
  }
  return sourceFork.branches.findIndex(
    (candidate) =>
      candidate.name === branch.name &&
      candidate.entry === branch.entry &&
      candidate.exit === branch.exit,
  );
};

const validateRegionMember = (
  member: string,
  branchName: string,
  branchPath: string,
  memberOwners: Map<string, string>,
  context: RegionContext,
  faults: MutableFault[],
): void => {
  const owner = memberOwners.get(member);
  if (owner !== undefined && owner !== branchName) {
    addFault(faults, 'DEF_FORK_REGION', branchPath, 'Fork branches overlap.');
  }
  memberOwners.set(member, branchName);
  const memberKind = context.nodeByKey.get(member)?.kind;
  if (memberKind === 'fork') {
    addFault(
      faults,
      'DEF_FORK_NESTED',
      `/nodes/${context.sourceIndexes.get(member) ?? 0}`,
      'Nested forks are forbidden.',
    );
  }
  if (memberKind === 'join') {
    addFault(
      faults,
      'DEF_FORK_REGION',
      `/nodes/${context.sourceIndexes.get(member) ?? 0}`,
      'Foreign join in fork region.',
    );
  }
};

const classifyForkBranch = (
  classification: ForkBranchClassification,
): CompiledForkRegion['branches'][number] => {
  const { branch, branchExits, context, faults, fork, forkPath, join, memberOwners } =
    classification;
  const branchIndex = sourceBranchIndex(fork, branch, context.sourceNodes);
  const branchPath = `${forkPath}/branches/${branchIndex}`;
  branchExits.set(branch.name, branch.exit);
  const members = [
    ...collectRegionMembers(branch.entry, branch.exit, join.key, context.adjacency),
  ].sort(compareUnicodeCodePoints);
  for (const member of members) {
    validateRegionMember(member, branch.name, branchPath, memberOwners, context, faults);
  }
  const exit = context.nodeByKey.get(branch.exit);
  if (exit?.kind !== 'task' || !members.includes(branch.exit)) {
    addFault(faults, 'DEF_FORK_REGION', `${branchPath}/exit`, 'Branch exit must be a member task.');
  }
  const exitEdges = context.buckets.outgoing.get(branch.exit) ?? [];
  if (exitEdges.length !== TASK_OUTCOMES.length || exitEdges.some((edge) => edge.to !== join.key)) {
    addFault(
      faults,
      'DEF_FORK_REGION',
      `/nodes/${context.sourceIndexes.get(branch.exit) ?? 0}`,
      'Every exit outcome must target the join.',
    );
  }
  for (const edge of exitEdges) {
    edge.role = 'readiness';
    edge.fork = fork.key;
    edge.branch = branch.name;
  }
  return { ...branch, members };
};

const regionEdgeIsPermitted = (
  edge: CompiledEdge,
  fork: ForkNode,
  join: JoinNode,
  memberOwners: ReadonlyMap<string, string>,
  branchExits: ReadonlyMap<string, string>,
): boolean => {
  const fromOwner = memberOwners.get(edge.from);
  const toOwner = memberOwners.get(edge.to);
  const exit = fromOwner !== undefined && edge.from === branchExits.get(fromOwner);
  const permittedExit = exit && edge.to === join.key;
  const permittedEntry = edge.from === fork.key && toOwner !== undefined;
  const permittedInternal = fromOwner !== undefined && fromOwner === toOwner;
  const directBarrier = edge.from === fork.key && edge.to === join.key;
  return (
    (fromOwner === undefined && toOwner === undefined) ||
    permittedExit ||
    permittedEntry ||
    permittedInternal ||
    directBarrier
  );
};

const validateRegionEdges = (
  fork: ForkNode,
  join: JoinNode,
  memberOwners: ReadonlyMap<string, string>,
  branchExits: ReadonlyMap<string, string>,
  context: RegionContext,
  faults: MutableFault[],
): void => {
  const regionEdges = new Set<MutableCompiledEdge>(context.buckets.outgoing.get(fork.key) ?? []);
  for (const member of memberOwners.keys()) {
    for (const edge of context.buckets.outgoing.get(member) ?? []) {
      regionEdges.add(edge);
    }
    for (const edge of context.buckets.incoming.get(member) ?? []) {
      regionEdges.add(edge);
    }
  }
  for (const edge of regionEdges) {
    if (!regionEdgeIsPermitted(edge, fork, join, memberOwners, branchExits)) {
      addFault(
        faults,
        'DEF_FORK_REGION',
        `/nodes/${context.sourceIndexes.get(edge.from) ?? 0}`,
        'Invalid fork-region edge.',
      );
    }
  }
};

const validateJoinThreshold = (
  join: JoinNode,
  branchCount: number,
  sourceIndexes: ReadonlyMap<string, number>,
  faults: MutableFault[],
): void => {
  if (join.policy.kind !== 'threshold') {
    return;
  }
  const { count } = join.policy;
  if (!Number.isSafeInteger(count) || count < 1 || count > branchCount) {
    addFault(
      faults,
      'DEF_JOIN_THRESHOLD',
      `/nodes/${sourceIndexes.get(join.key) ?? 0}/policy/count`,
      'Join threshold exceeds branch count.',
    );
  }
};

const classifyForkRegion = (
  fork: ForkNode,
  context: RegionContext,
  faults: MutableFault[],
): CompiledForkRegion | undefined => {
  const forkPath = `/nodes/${context.sourceIndexes.get(fork.key) ?? 0}`;
  const join = context.nodeByKey.get(fork.join);
  if (join?.kind !== 'join' || join.fork !== fork.key) {
    addFault(faults, 'DEF_FORK_JOIN', `${forkPath}/join`, 'Fork/join is not reciprocal.');
    return undefined;
  }
  const memberOwners = new Map<string, string>();
  const branchExits = new Map<string, string>();
  const branches = fork.branches.map((branch) =>
    classifyForkBranch({
      branch,
      branchExits,
      context,
      faults,
      fork,
      forkPath,
      join,
      memberOwners,
    }),
  );
  validateRegionEdges(fork, join, memberOwners, branchExits, context, faults);
  validateJoinThreshold(join, fork.branches.length, context.sourceIndexes, faults);
  return { fork: fork.key, join: join.key, branches };
};

const validateJoinReciprocity = (
  join: JoinNode,
  context: RegionContext,
  faults: MutableFault[],
): void => {
  const fork = context.nodeByKey.get(join.fork);
  if (fork?.kind !== 'fork' || fork.join !== join.key) {
    addFault(
      faults,
      'DEF_FORK_JOIN',
      `/nodes/${context.sourceIndexes.get(join.key) ?? 0}/fork`,
      'Join/fork is not reciprocal.',
    );
  }
};

const validateJoinIngress = (
  join: JoinNode,
  context: RegionContext,
  faults: MutableFault[],
): void => {
  const fork = context.nodeByKey.get(join.fork);
  const declaredExits = fork?.kind === 'fork' ? fork.branches.map((branch) => branch.exit) : [];
  for (const edge of context.buckets.incoming.get(join.key) ?? []) {
    const owningForkActivation =
      edge.from === join.fork && edge.role === 'activation' && edge.outcome === 'forked';
    const declaredReadiness =
      declaredExits.includes(edge.from) && edge.role === 'readiness' && edge.fork === join.fork;
    if (!owningForkActivation && !declaredReadiness) {
      addFault(
        faults,
        'DEF_FORK_REGION',
        `/nodes/${context.sourceIndexes.get(edge.from) ?? 0}`,
        'Invalid join ingress.',
      );
    }
  }
};

const classifyForkRegions = (
  nodes: readonly PipelineNode[],
  inputEdges: readonly CompiledEdge[],
  sourceIndexes: ReadonlyMap<string, number>,
  sourceNodes: ReadonlyMap<string, PipelineNode>,
  faults: MutableFault[],
): { readonly edges: readonly CompiledEdge[]; readonly regions: readonly CompiledForkRegion[] } => {
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const edges: MutableCompiledEdge[] = inputEdges.map((edge) => ({ ...edge }));
  const context: RegionContext = {
    adjacency: buildGraphAdjacency(edges),
    buckets: buildEdgeBuckets(edges),
    nodeByKey,
    sourceIndexes,
    sourceNodes,
  };
  const regions = nodes
    .filter((node) => node.kind === 'fork')
    .map((fork) => classifyForkRegion(fork, context, faults))
    .filter((region): region is CompiledForkRegion => region !== undefined);
  for (const join of nodes.filter((node) => node.kind === 'join')) {
    validateJoinReciprocity(join, context, faults);
    validateJoinIngress(join, context, faults);
  }
  return { edges, regions };
};

const validateDag = (
  entry: string,
  nodes: readonly PipelineNode[],
  edges: readonly CompiledEdge[],
  sourceIndexes: ReadonlyMap<string, number>,
  faults: MutableFault[],
): readonly string[] => {
  const keys = nodes.map((node) => node.key);
  const order = topologicalSort(keys, edges);
  if (order === null) {
    addFault(faults, 'DEF_CYCLE', '/nodes', 'Pipeline graph contains a cycle.');
  }
  const reachable = reachableNodeKeys(entry, edges);
  const terminalKeys = nodes.filter((node) => node.kind === 'terminal').map((node) => node.key);
  const leading = nodesLeadingToTerminals(terminalKeys, edges);
  for (const node of nodes) {
    if (!reachable.has(node.key)) {
      addFault(
        faults,
        'DEF_UNREACHABLE',
        `/nodes/${sourceIndexes.get(node.key) ?? 0}`,
        'Node is unreachable.',
      );
    }
    if (!leading.has(node.key)) {
      addFault(
        faults,
        'DEF_DEAD_END',
        `/nodes/${sourceIndexes.get(node.key) ?? 0}`,
        'Node cannot reach a terminal.',
      );
    }
  }
  return order ?? [];
};

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) {
      deepFreeze(descriptor.value);
    }
  }
  return Object.freeze(value);
};

const buildIndexes = (
  nodes: readonly PipelineNode[],
  edges: readonly CompiledEdge[],
): Pick<CompiledPipeline, 'incomingIndex' | 'nodeIndex' | 'outgoingIndex'> => {
  const outgoing = new Map(nodes.map((node) => [node.key, [] as number[]]));
  const incoming = new Map(nodes.map((node) => [node.key, [] as number[]]));
  edges.forEach((edge, index) => {
    outgoing.get(edge.from)?.push(index);
    incoming.get(edge.to)?.push(index);
  });
  return {
    nodeIndex: nodes.map((node, index) => ({ key: node.key, node: index })),
    outgoingIndex: nodes.map((node) => ({ key: node.key, edges: outgoing.get(node.key) ?? [] })),
    incomingIndex: nodes.map((node) => ({ key: node.key, edges: incoming.get(node.key) ?? [] })),
  };
};

const isDefinitionFaultCode = (value: string): value is DefinitionFaultCode =>
  DEFINITION_FAULT_PHASES.some((phase) => (phase.codes as readonly string[]).includes(value));

const orderedFaults = (faults: readonly MutableFault[]): readonly DefinitionFault[] =>
  orderFaults(faults, DEFINITION_FAULT_PHASES, 'DEF_LIMIT', 'definition').map((fault) => {
    if (!isDefinitionFaultCode(fault.code)) {
      throw new Error('Unknown definition fault code.');
    }
    return Object.freeze({ code: fault.code, path: fault.path, message: fault.message });
  });

const definitionArrayLimit = (path: string): number => {
  if (path === '/facts') {
    return PIPELINE_LIMITS.definition.declaredFacts;
  }
  if (path === '/nodes') {
    return PIPELINE_LIMITS.definition.nodes;
  }
  if (/^\/nodes\/(?:0|[1-9]\d*)\/cases$/u.test(path)) {
    return PIPELINE_LIMITS.definition.branchCasesPerNode;
  }
  if (/^\/nodes\/(?:0|[1-9]\d*)\/cases\/(?:0|[1-9]\d*)\/when\/values$/u.test(path)) {
    return PIPELINE_LIMITS.definition.predicateValuesPerCase;
  }
  if (/^\/nodes\/(?:0|[1-9]\d*)\/branches$/u.test(path)) {
    return PIPELINE_LIMITS.definition.forkBranchesPerNode;
  }
  if (/^\/nodes\/(?:0|[1-9]\d*)\/candidates$/u.test(path)) {
    return PIPELINE_LIMITS.definition.candidatesPerNode;
  }
  if (/^\/nodes\/(?:0|[1-9]\d*)\/resolutions$/u.test(path)) {
    return PIPELINE_LIMITS.definition.resolutionsPerNode;
  }
  return PIPELINE_LIMITS.facts.total;
};

export const compilePipeline = (definition: PipelineDefinition): PipelineCompilation => {
  const portable = inspectPortableValueSet(definition, { arrayLimit: definitionArrayLimit });
  if (portable.issues.length > 0) {
    return {
      ok: false,
      faults: orderedFaults(
        portable.issues.map((issue) => ({
          code: issue.code === 'limit' ? 'DEF_LIMIT' : 'DEF_TYPE',
          path: issue.path,
          message: 'Invalid portable input.',
        })),
      ),
    };
  }
  if (!isRecord(portable.value)) {
    return {
      ok: false,
      faults: orderedFaults([
        { code: 'DEF_TYPE', path: '', message: 'Expected definition object.' },
      ]),
    };
  }
  const value = portable.value;
  const faults: MutableFault[] = [];
  unknownFields(value, ['entry', 'facts', 'nodes', 'schemaVersion'], '', faults);
  if (value.schemaVersion !== 1) {
    addFault(faults, 'DEF_SCHEMA', '/schemaVersion', 'schemaVersion must be 1.');
  }
  const facts = validateFacts(value.facts, faults);
  const validatedNodes = validateNodes(value.nodes, facts, faults);
  const derivableNodes = validatedNodes.filter((record) => record.uniqueKey);
  const sourceIndexes = new Map<string, number>();
  const sourceNodes = new Map<string, PipelineNode>();
  for (const record of derivableNodes) {
    sourceIndexes.set(record.node.key, record.sourceIndex);
    sourceNodes.set(record.node.key, record.node);
  }
  const copiedNodes = derivableNodes
    .map(({ node }) => copyNode(node))
    .sort((left, right) => compareUnicodeCodePoints(left.key, right.key));
  const preliminaryEdges = copiedNodes.flatMap(edgesForNode);
  validateReferences(value.entry, copiedNodes, preliminaryEdges, sourceIndexes, faults);
  const classified = classifyForkRegions(
    copiedNodes,
    preliminaryEdges,
    sourceIndexes,
    sourceNodes,
    faults,
  );
  const edges = [...classified.edges].sort(edgeComparator);
  const entry = typeof value.entry === 'string' ? value.entry : '';
  const topologicalOrder = validateDag(entry, copiedNodes, edges, sourceIndexes, faults);
  if (faults.length > 0) {
    return { ok: false, faults: orderedFaults(faults) };
  }
  const sortedFacts = [...facts].sort((left, right) =>
    compareUnicodeCodePoints(left.key, right.key),
  );
  const forkRegions = [...classified.regions]
    .map((region) => ({
      ...region,
      branches: [...region.branches].sort((left, right) =>
        compareUnicodeCodePoints(left.name, right.name),
      ),
    }))
    .sort((left, right) => compareUnicodeCodePoints(left.fork, right.fork));
  return {
    ok: true,
    pipeline: deepFreeze({
      schemaVersion: 1,
      entry,
      facts: sortedFacts,
      nodes: copiedNodes,
      edges,
      topologicalOrder,
      forkRegions,
      ...buildIndexes(copiedNodes, edges),
    }),
  };
};
