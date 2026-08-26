import type { MachineFrame, PipelineCommand, PipelineEvent } from '../../src/kernel/index.js';
import { kernelDigest } from './kernel-builders.js';
import { emptySchema } from './source-builders.js';

const parentFrameKey = kernelDigest('2');
const childFrameKey = kernelDigest('3');
const nodeId = kernelDigest('4');
const regionId = kernelDigest('5');

const frameBase = {
  key: childFrameKey,
  parentFrameKey,
  scopeInput: {},
  nodeResults: {},
};

const regionExecution = {
  regionId,
  status: 'active' as const,
  ready: [nodeId],
  selectedExit: null,
};

export const machineFrameExamples = (): readonly MachineFrame[] => [
  {
    ...frameBase,
    ...regionExecution,
    kind: 'rootRegion',
    parentFrameKey: null,
  },
  { ...frameBase, ...regionExecution, kind: 'callRegion' },
  { ...frameBase, ...regionExecution, kind: 'parallelBranch', branchKey: 'left' },
  { ...frameBase, ...regionExecution, kind: 'repeatBody', ordinal: 0 },
  { ...frameBase, ...regionExecution, kind: 'mapItem', itemKey: 'item' },
  {
    ...frameBase,
    kind: 'call',
    nodeId,
    childRegionKey: childFrameKey,
    childResult: null,
    status: 'active',
  },
  {
    ...frameBase,
    kind: 'parallel',
    nodeId,
    mode: 'generic',
    branchRegionKeys: { left: childFrameKey },
    branchResults: {},
    status: 'active',
    selected: null,
  },
  {
    ...frameBase,
    kind: 'parallel',
    nodeId,
    mode: 'votes',
    branchRegionKeys: { reviewer: childFrameKey },
    branchResults: {},
    status: 'active',
    selected: null,
  },
  {
    ...frameBase,
    kind: 'repeat',
    nodeId,
    iteration: 0,
    bodyRegionKey: null,
    bodyResult: null,
    previousOutput: null,
    status: 'active',
  },
  {
    ...frameBase,
    kind: 'map',
    nodeId,
    itemKeys: ['item'],
    itemSourceIndexes: [0],
    pendingItemKeys: ['item'],
    activeItemKeys: [],
    completedItems: [],
    status: 'active',
    selected: null,
    selectedFailureItemKey: null,
  },
];

const ref = Object.freeze({ programDigest: kernelDigest(), frameKey: childFrameKey, nodeId });
const operation = { commandKey: kernelDigest('6'), ref };

export const pipelineEventExamples = (): readonly PipelineEvent[] => [
  { kind: 'activitySucceeded', ...operation, output: {} },
  { kind: 'activityFailed', ...operation, errorCode: 'FAILED' },
  { kind: 'activityCancelled', ...operation },
  { kind: 'waitCompleted', ...operation },
  { kind: 'signalReceived', ...operation, signal: 'ready', payload: {} },
  { kind: 'waitCancelled', ...operation },
  {
    kind: 'gateResolved',
    ...operation,
    resolution: { kind: 'answer', answer: 'yes', actorRef: 'actor', payload: null },
  },
  { kind: 'gateResolved', ...operation, resolution: { kind: 'deadline' } },
  { kind: 'gateCancelled', ...operation },
  { kind: 'cancelRequested', reasonCode: 'USER' },
];

const command = { key: kernelDigest('7'), ref };

export const pipelineCommandExamples = (): readonly PipelineCommand[] => [
  { kind: 'cancelPending', ...command, targets: [kernelDigest('8')], reasonCode: 'USER' },
  {
    kind: 'dispatchActivity',
    ...command,
    requirementKey: 'agent',
    input: {},
    outputSchema: emptySchema(),
  },
  { kind: 'scheduleWait', ...command, wait: { kind: 'duration', durationMs: 1 } },
  {
    kind: 'scheduleWait',
    ...command,
    wait: { kind: 'signal', signal: 'ready', payloadSchema: emptySchema() },
  },
  {
    kind: 'openHumanGate',
    ...command,
    subject: 'Approve?',
    answers: ['yes'],
    authorizationRequirements: [],
    payloadSchema: null,
    deadline: null,
  },
  { kind: 'complete', ...command, outcome: 'ok', output: {} },
  { kind: 'fail', ...command, code: 'FAILED', path: '' },
  { kind: 'cancel', ...command, reasonCode: 'USER' },
];
