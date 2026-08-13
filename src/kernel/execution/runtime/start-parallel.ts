import {
  compareUnicodeCodePoints,
  type JsonPointer,
  type JsonValue,
} from '../../../foundation/index.js';
import type { GenericParallelBranchResult, ProgramParallelNode } from '../../../program/index.js';
import type { ParallelMachineFrame } from '../../contracts/structured-frames.js';
import { consumeRegionNode } from '../region-state.js';
import { resolveMapping, valueMatchesSchema, type SelectorEnvironment } from '../selectors.js';
import type { RuntimeContext } from './context.js';
import { createParallelOwner } from './owner-frames.js';
import { classifyGenericParallel, classifyVoteParallel } from './policies.js';
import { createParallelBranchFrame } from './region-frames.js';
import { failure } from './results.js';

type BranchInput = {
  readonly key: string;
  readonly input: JsonValue;
};

type FailedBranch = Extract<GenericParallelBranchResult, { readonly status: 'failed' }>;

const inputFailure = (path: JsonPointer): FailedBranch =>
  Object.freeze({
    status: 'failed' as const,
    failure: failure('DATA_POINTER_MISSING', path),
  });

const schemaFailure = (): FailedBranch =>
  Object.freeze({
    status: 'failed' as const,
    failure: failure('DATA_SCHEMA_MISMATCH'),
  });

const preflightBranches = (
  node: ProgramParallelNode,
  environment: SelectorEnvironment,
): {
  readonly inputs: readonly BranchInput[];
  readonly failures: Readonly<Record<string, FailedBranch>>;
} => {
  const inputs: BranchInput[] = [];
  const failures: Record<string, FailedBranch> = {};
  for (const branch of [...node.branches].sort((left, right) =>
    compareUnicodeCodePoints(left.key, right.key),
  )) {
    const selected = resolveMapping(branch.input, environment);
    if (!selected.ok) {
      failures[branch.key] = inputFailure(selected.path);
    } else if (!valueMatchesSchema(branch.region.inputSchema, selected.value)) {
      failures[branch.key] = schemaFailure();
    } else {
      inputs.push(Object.freeze({ key: branch.key, input: selected.value }));
    }
  }
  return Object.freeze({ inputs: Object.freeze(inputs), failures: Object.freeze(failures) });
};

const withPreflightResults = (
  owner: ParallelMachineFrame,
  node: ProgramParallelNode,
  failures: Readonly<Record<string, FailedBranch>>,
): ParallelMachineFrame => {
  if (owner.mode === 'generic' && node.mode === 'generic') {
    const branchResults: Readonly<Record<string, GenericParallelBranchResult>> = failures;
    return Object.freeze({
      ...owner,
      branchResults,
      selected: classifyGenericParallel(node, branchResults, null),
    });
  }
  if (owner.mode === 'votes' && node.mode === 'votes') {
    const branchResults = failures;
    return Object.freeze({
      ...owner,
      branchResults,
      selected: classifyVoteParallel(node, branchResults, null),
    });
  }
  return owner;
};

const locallyCancel = (
  owner: ParallelMachineFrame,
  inputs: readonly BranchInput[],
): ParallelMachineFrame => {
  const cancelled = Object.freeze(
    Object.fromEntries(
      inputs.map(({ key }) => [key, Object.freeze({ status: 'cancelled' as const })]),
    ),
  );
  return owner.mode === 'generic'
    ? Object.freeze({
        ...owner,
        branchResults: Object.freeze({ ...owner.branchResults, ...cancelled }),
        status: 'completed',
      })
    : Object.freeze({
        ...owner,
        branchResults: Object.freeze({ ...owner.branchResults, ...cancelled }),
        status: 'completed',
      });
};

export const startParallel = (
  context: RuntimeContext,
  parentKey: ParallelMachineFrame['parentFrameKey'],
  node: ProgramParallelNode,
  environment: SelectorEnvironment,
): boolean => {
  const parent = context.draft.frames.get(parentKey);
  if (parent === undefined || !('ready' in parent)) {
    return false;
  }
  const consumed = consumeRegionNode(parent, node.id);
  const created = createParallelOwner(parent.key, parent.scopeInput, node);
  if (consumed === null || created === null) {
    return false;
  }
  const preflight = preflightBranches(node, environment);
  let owner = withPreflightResults(created, node, preflight.failures);
  context.draft.setFrame(consumed);
  if (!context.draft.addFrame(owner)) {
    return false;
  }
  if (owner.selected !== null && node.remaining === 'cancel') {
    owner = locallyCancel(owner, preflight.inputs);
    context.draft.setFrame(owner);
    context.enqueue(owner.key);
    return true;
  }
  const regionKeys: Record<string, ParallelMachineFrame['key']> = {};
  for (const branchInput of preflight.inputs) {
    const branch = node.branches.find(({ key }) => key === branchInput.key);
    const frame =
      branch === undefined
        ? null
        : createParallelBranchFrame(owner.key, branch.key, branch.region, branchInput.input);
    if (frame === null || !context.draft.addFrame(frame)) {
      return false;
    }
    regionKeys[branchInput.key] = frame.key;
    context.enqueue(frame.key);
  }
  owner = Object.freeze({
    ...owner,
    branchRegionKeys: Object.freeze(regionKeys),
    status: owner.selected === null ? 'active' : 'draining',
  });
  context.draft.setFrame(owner);
  if (preflight.inputs.length === 0) {
    context.enqueue(owner.key);
  }
  return true;
};
