import { compareUnicodeCodePoints, isValidKey, isValidSemanticName } from '../../policy/index.js';
import type { CompiledInspectionFaultCollector } from './compiled-inspection-fault-collector.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const schema = (path: string, message: string, faults: CompiledInspectionFaultCollector): void =>
  faults.add({ code: 'DECODE_SCHEMA', path, message });

const reference = (
  value: unknown,
  path: string,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!isValidKey(value)) {
    schema(path, 'Compiled fork-region reference is invalid.', faults);
  } else if (nodeKeys !== undefined && !nodeKeys.has(value)) {
    faults.add({
      code: 'DECODE_REFERENCE',
      path,
      message: 'Compiled fork-region reference does not reference a node.',
    });
  }
};

const inspectMembers = (
  value: unknown,
  path: string,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!Array.isArray(value)) {
    schema(path, 'Compiled fork-region members must be an array.', faults);
    return;
  }
  let previous: string | undefined;
  const seen = new Set<string>();
  value.forEach((member, index) => {
    reference(member, `${path}/${index}`, nodeKeys, faults);
    if (typeof member === 'string' && seen.has(member)) {
      faults.add({
        code: 'DECODE_REFERENCE',
        path: `${path}/${index}`,
        message: 'Compiled fork-region member is duplicated.',
      });
    } else if (
      typeof member === 'string' &&
      previous !== undefined &&
      compareUnicodeCodePoints(previous, member) > 0
    ) {
      faults.add({
        code: 'DECODE_CANONICAL',
        path: `${path}/${index}`,
        message: 'Compiled fork-region members are not in canonical order.',
      });
    }
    if (typeof member === 'string') {
      seen.add(member);
    }
    previous = typeof member === 'string' ? member : previous;
  });
};

const inspectBranch = (
  branch: unknown,
  path: string,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!isRecord(branch)) {
    schema(path, 'Compiled fork-region branch must be an object.', faults);
    return;
  }
  const fields = Object.keys(branch);
  if (
    fields.length !== 4 ||
    !['entry', 'exit', 'members', 'name'].every((field) => fields.includes(field))
  ) {
    schema(path, 'Compiled fork-region branch fields are invalid.', faults);
    return;
  }
  if (!isValidSemanticName(branch['name'])) {
    schema(`${path}/name`, 'Compiled fork-region branch name is invalid.', faults);
  }
  reference(branch['entry'], `${path}/entry`, nodeKeys, faults);
  reference(branch['exit'], `${path}/exit`, nodeKeys, faults);
  inspectMembers(branch['members'], `${path}/members`, nodeKeys, faults);
};

export const inspectCompiledRegions = (
  value: unknown,
  nodeKeys: ReadonlySet<string> | undefined,
  faults: CompiledInspectionFaultCollector,
): void => {
  if (!Array.isArray(value)) {
    return;
  }
  value.forEach((region, index) => {
    const path = `/forkRegions/${index}`;
    if (!isRecord(region)) {
      schema(path, 'Compiled fork region must be an object.', faults);
      return;
    }
    const fields = Object.keys(region);
    if (
      fields.length !== 3 ||
      !['branches', 'fork', 'join'].every((field) => fields.includes(field))
    ) {
      schema(path, 'Compiled fork-region fields are invalid.', faults);
      return;
    }
    reference(region['fork'], `${path}/fork`, nodeKeys, faults);
    reference(region['join'], `${path}/join`, nodeKeys, faults);
    if (!Array.isArray(region['branches'])) {
      schema(`${path}/branches`, 'Compiled fork-region branches must be an array.', faults);
      return;
    }
    let previousName: string | undefined;
    const names = new Set<string>();
    region['branches'].forEach((branch, branchIndex) => {
      const branchPath = `${path}/branches/${branchIndex}`;
      inspectBranch(branch, branchPath, nodeKeys, faults);
      const name = isRecord(branch) ? branch['name'] : undefined;
      if (typeof name === 'string' && names.has(name)) {
        faults.add({
          code: 'DECODE_REFERENCE',
          path: `${branchPath}/name`,
          message: 'Compiled fork-region branch name is duplicated.',
        });
      } else if (
        typeof name === 'string' &&
        previousName !== undefined &&
        compareUnicodeCodePoints(previousName, name) > 0
      ) {
        faults.add({
          code: 'DECODE_CANONICAL',
          path: branchPath,
          message: 'Compiled fork-region branches are not in canonical order.',
        });
      }
      if (typeof name === 'string') {
        names.add(name);
        previousName = name;
      }
    });
  });
};
