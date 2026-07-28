export interface TypeClosureNode {
  readonly name: string;
  readonly version: string;
  readonly sourceId: string;
  readonly manifestDependencies: Readonly<Record<string, string>>;
  readonly snapshotDependencies: Readonly<Record<string, string>>;
}

export interface TypeClosureInput {
  readonly rootName: string;
  readonly rootRange: string;
  readonly rootVersion: string;
  readonly nodes: readonly TypeClosureNode[];
}

export interface TypeClosurePlanEntry {
  readonly name: string;
  readonly version: string;
  readonly sourceId: string;
}

interface StableVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const unsupportedRange = (): never => {
  throw new Error('[package-type-range-unsupported]');
};

const closureFailure = (): never => {
  throw new Error('[package-type-closure]');
};

const parseVersion = (source: string): StableVersion => {
  const match = source.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
  if (!match) {
    return unsupportedRange();
  }
  const components = match.slice(1).map(Number);
  if (components.some((component) => !Number.isSafeInteger(component))) {
    return unsupportedRange();
  }
  const [major, minor, patch] = components;
  if (major === undefined || minor === undefined || patch === undefined) {
    return unsupportedRange();
  }
  return { major, minor, patch };
};

const compareVersions = (left: StableVersion, right: StableVersion): number =>
  left.major - right.major || left.minor - right.minor || left.patch - right.patch;

export const satisfiesTypeDependencyRange = (range: string, selected: string): boolean => {
  const selectedVersion = parseVersion(selected);
  const match = range.match(/^([~^]?)(.+)$/u);
  if (!match?.[2]) {
    return unsupportedRange();
  }
  const operator = match[1] ?? '';
  const lower = parseVersion(match[2]);
  if (operator === '') {
    return compareVersions(selectedVersion, lower) === 0;
  }
  let upper: StableVersion;
  if (operator === '~') {
    upper = { major: lower.major, minor: lower.minor + 1, patch: 0 };
  } else if (operator === '^' && lower.major > 0) {
    upper = { major: lower.major + 1, minor: 0, patch: 0 };
  } else if (operator === '^' && lower.minor > 0) {
    upper = { major: 0, minor: lower.minor + 1, patch: 0 };
  } else if (operator === '^') {
    upper = { major: 0, minor: 0, patch: lower.patch + 1 };
  } else {
    return unsupportedRange();
  }
  return (
    compareVersions(selectedVersion, lower) >= 0 && compareVersions(selectedVersion, upper) < 0
  );
};

export const planTypeClosure = (input: TypeClosureInput): readonly TypeClosurePlanEntry[] => {
  if (!satisfiesTypeDependencyRange(input.rootRange, input.rootVersion)) {
    return closureFailure();
  }
  const nodes = new Map<string, TypeClosureNode>();
  for (const node of input.nodes) {
    const existing = nodes.get(node.name);
    if (existing || node.name.length === 0 || node.sourceId.length === 0) {
      return closureFailure();
    }
    parseVersion(node.version);
    nodes.set(node.name, node);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const plan: TypeClosurePlanEntry[] = [];

  const visit = (name: string, version: string): void => {
    const node = nodes.get(name);
    if (!node || node.version !== version || visiting.has(name)) {
      return closureFailure();
    }
    if (visited.has(name)) {
      return;
    }
    const manifestNames = Object.keys(node.manifestDependencies).sort();
    const snapshotNames = Object.keys(node.snapshotDependencies).sort();
    if (manifestNames.join('\0') !== snapshotNames.join('\0')) {
      return closureFailure();
    }
    visiting.add(name);
    for (const dependencyName of manifestNames) {
      const range = node.manifestDependencies[dependencyName];
      const selected = node.snapshotDependencies[dependencyName];
      if (
        range === undefined ||
        selected === undefined ||
        !satisfiesTypeDependencyRange(range, selected)
      ) {
        return closureFailure();
      }
      visit(dependencyName, selected);
    }
    visiting.delete(name);
    visited.add(name);
    plan.push(Object.freeze({ name: node.name, version: node.version, sourceId: node.sourceId }));
  };

  visit(input.rootName, input.rootVersion);
  if (visited.size !== nodes.size) {
    return closureFailure();
  }
  return Object.freeze(plan);
};
