import { describe, expect, it } from 'vitest';

import { advancePipeline, createInitialPipelineState } from '../../src/kernel/index.js';
import type { ProgramNode } from '../../src/program/index.js';
import type { SourceNode } from '../../src/source/index.js';
import { kernelModule, kernelProgram, kernelRegion } from '../support/kernel-builders.js';
import {
  reverseNestedKeyMapInput,
  reverseNestedKeyMapProgram,
} from '../support/large-map-builders.js';
import { programEnd } from '../support/program-builders.js';
import { endNode, sourceNodeBuilders } from '../support/source-builders.js';
import { compileStructuredNode } from '../support/structured-machine.js';

describe('kernel structured execution', () => {
  it('saturates synchronous structured owners and empty maps to global quiescence', () => {
    for (const node of [sourceNodeBuilders.parallel(), sourceNodeBuilders.repeat()]) {
      expect(createInitialPipelineState(compileStructuredNode(node), {})).toMatchObject({
        kind: 'initialized',
        state: { status: 'succeeded', frames: [], pending: [] },
        commands: [{ kind: 'complete' }],
      });
    }
    const initial = createInitialPipelineState(
      reverseNestedKeyMapProgram(0),
      reverseNestedKeyMapInput(0),
    );
    expect(initial).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [] },
      commands: [{ kind: 'complete' }],
    });
  });

  it.each([true, false])('selects a %s literal choice route', (value) => {
    const bundle = compileStructuredNode({
      ...sourceNodeBuilders.choice(),
      selector: { kind: 'literal', value },
    });
    expect(createInitialPipelineState(bundle, {})).toMatchObject({
      state: { status: 'succeeded' },
      commands: [{ kind: 'complete' }],
    });
  });

  it('rejects a Program whose choice selector is statically unavailable', () => {
    const end = programEnd();
    const choice: ProgramNode = {
      kind: 'choice',
      id: `sha256:${'1'.repeat(64)}`,
      selector: { kind: 'scopeInput', pointer: '/missing' },
      cases: [{ key: 'yes', when: { kind: 'equals', value: true }, target: end.id }],
      otherwise: end.id,
    };
    const bundle = kernelProgram([
      kernelModule('main', kernelRegion([choice, end], { entry: choice.id })),
    ]);
    expect(createInitialPipelineState(bundle, {})).toMatchObject({
      state: { status: 'failed', fault: { code: 'PROGRAM_INVALID' } },
      commands: [{ kind: 'fail', code: 'PROGRAM_INVALID' }],
    });
  });

  it('copies a called region result into its enclosing region', () => {
    const end = programEnd();
    const childEnd = programEnd(`sha256:${'8'.repeat(64)}`);
    const child = kernelModule(
      'child',
      kernelRegion([childEnd], { id: `sha256:${'7'.repeat(64)}` }),
    );
    const call = {
      kind: 'call' as const,
      id: `sha256:${'1'.repeat(64)}` as const,
      module: 'child',
      input: {},
      outputSchema: child.outputSchema,
      routes: {
        outcomes: [{ outcome: 'ok', target: end.id }] as const,
        failed: end.id,
        cancelled: end.id,
      },
    };
    const main = kernelModule('main', kernelRegion([call, end], { entry: call.id }));
    const initial = createInitialPipelineState(kernelProgram([child, main], 'main'), {});
    expect(initial).toMatchObject({
      state: { status: 'succeeded' },
      commands: [{ kind: 'complete' }],
    });
  });

  it('keeps parallel siblings live in the same activation burst', () => {
    const left = {
      ...sourceNodeBuilders.script('left-done'),
      id: 'left-work',
      requirementKey: 'left',
    };
    const right = {
      ...sourceNodeBuilders.script('right-done'),
      id: 'right-work',
      requirementKey: 'right',
    };
    const node = {
      ...sourceNodeBuilders.parallel(),
      branches: [
        {
          ...sourceNodeBuilders.parallel().branches[0],
          region: {
            ...sourceNodeBuilders.parallel().branches[0].region,
            entry: left.id,
            nodes: [left, endNode('left-done')],
          },
        },
        {
          ...sourceNodeBuilders.parallel().branches[1],
          region: {
            ...sourceNodeBuilders.parallel().branches[1].region,
            entry: right.id,
            nodes: [right, endNode('right-done')],
          },
        },
      ],
    } satisfies Extract<SourceNode, { readonly kind: 'parallel' }>;
    const initial = createInitialPipelineState(compileStructuredNode(node), {});
    expect(initial.commands.map(({ kind }) => kind)).toEqual([
      'dispatchActivity',
      'dispatchActivity',
    ]);
    expect(initial.state.pending).toHaveLength(2);
  });

  it('folds compiler-emitted vote siblings through the consensus policy', () => {
    const bundle = compileStructuredNode(sourceNodeBuilders.consensus());
    const initial = createInitialPipelineState(bundle, { prompt: 'vote' });
    const commands = initial.commands.filter((command) => command.kind === 'dispatchActivity');
    expect(commands).toHaveLength(2);
    const [first, second] = commands;
    if (first?.kind !== 'dispatchActivity' || second?.kind !== 'dispatchActivity') {
      throw new TypeError('Expected two vote dispatches.');
    }
    const accepted = advancePipeline(bundle, initial.state, {
      kind: 'activitySucceeded',
      commandKey: first.key,
      ref: first.ref,
      output: { vote: 'approve' },
    });
    expect(accepted).toMatchObject({ kind: 'advanced', state: { status: 'running' } });
    const completed = advancePipeline(bundle, accepted.state, {
      kind: 'activitySucceeded',
      commandKey: second.key,
      ref: second.ref,
      output: { vote: 'approve' },
    });
    expect(completed).toMatchObject({ kind: 'advanced', state: { status: 'succeeded' } });
  });

  it.each([
    ['activityFailed', { errorCode: 'PARTICIPANT_FAILED' }],
    ['activityCancelled', {}],
  ] as const)('drains compiler-emitted vote siblings after %s', (kind, fields) => {
    const bundle = compileStructuredNode(sourceNodeBuilders.consensus());
    const initial = createInitialPipelineState(bundle, { prompt: 'vote' });
    const commands = initial.commands.filter((command) => command.kind === 'dispatchActivity');
    const [first, second] = commands;
    if (first?.kind !== 'dispatchActivity' || second?.kind !== 'dispatchActivity') {
      throw new TypeError('Expected two vote dispatches.');
    }
    const selected = advancePipeline(bundle, initial.state, {
      kind,
      commandKey: first.key,
      ref: first.ref,
      ...fields,
    });
    expect(selected).toMatchObject({ state: { status: 'running' }, commands: [] });
    const owner = selected.state.frames.find((frame) => frame.kind === 'parallel');
    expect(owner).toMatchObject({
      kind: 'parallel',
      selected: 'participantFailed',
      status: 'draining',
    });
    const completed = advancePipeline(bundle, selected.state, {
      kind: 'activitySucceeded',
      commandKey: second.key,
      ref: second.ref,
      output: { vote: 'approve' },
    });
    expect(completed).toMatchObject({ state: { status: 'succeeded' } });
  });

  it('preserves participantFailed while acknowledging requested sibling cleanup', () => {
    const bundle = compileStructuredNode({
      ...sourceNodeBuilders.consensus(),
      remaining: 'cancel',
    });
    const initial = createInitialPipelineState(bundle, { prompt: 'vote' });
    const [first, second] = initial.commands.filter(
      (command) => command.kind === 'dispatchActivity',
    );
    if (first?.kind !== 'dispatchActivity' || second?.kind !== 'dispatchActivity') {
      throw new TypeError('Expected two vote dispatches.');
    }
    const selected = advancePipeline(bundle, initial.state, {
      kind: 'activityCancelled',
      commandKey: first.key,
      ref: first.ref,
    });
    const owner = selected.state.frames.find((frame) => frame.kind === 'parallel');
    expect(owner).toMatchObject({ selected: 'participantFailed', status: 'cancelling' });
    expect(selected.commands).toMatchObject([{ kind: 'cancelPending', targets: [second.key] }]);
    const completed = advancePipeline(bundle, selected.state, {
      kind: 'activityCancelled',
      commandKey: second.key,
      ref: second.ref,
    });
    expect(completed).toMatchObject({ state: { status: 'succeeded' } });
  });
});
