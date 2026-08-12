import { describe, expect, it } from 'vitest';

import { kernelDigest } from '../support/kernel-builders.js';
import { pipelineCommandExamples } from '../support/kernel-contract-examples.js';
import {
  cancelCommand,
  cancelPendingCommand,
  completeCommand,
  dispatchActivityCommand,
  failCommand,
  canonicalCommands,
  compareCommands,
  computeCommandKey,
  computeEventDigest,
  computeFrameKey,
} from '../support/kernel-internal.js';
import { emptySchema } from '../support/source-builders.js';

describe('kernel structural identities', () => {
  it('pins the normative root frame and dispatch command vectors', () => {
    const frameKey = computeFrameKey({
      kind: 'rootRegion',
      parentFrameKey: null,
      regionId: kernelDigest('1'),
    });
    expect(frameKey).toBe(
      'sha256:2c6bc1ea876c7f591aa19f1477e1f9da47e22a0cf83b567f6bc5b9568774f61b',
    );
    if (frameKey === null) {
      throw new TypeError('Expected the root frame key.');
    }
    expect(
      computeCommandKey('dispatchActivity', {
        programDigest: kernelDigest(),
        frameKey,
        nodeId: kernelDigest('1'),
      }),
    ).toBe('sha256:843e4452009d1a2c365449a902a44f846ad0b3ea54271db4fff2ba7e79987aae');
  });

  it('covers every structural payload and event replay domain', () => {
    const parent = kernelDigest('2');
    const regionId = kernelDigest('3');
    const nodeId = kernelDigest('4');
    const vectors = [
      [
        { kind: 'initialization', parentFrameKey: null, programDigest: null },
        'sha256:b15ff8e8f9172a2ecc0ffe97cbc63ac3198f16a8e47baae28e1b09a5b9ca1086',
      ],
      [
        { kind: 'call', parentFrameKey: parent, nodeId },
        'sha256:6d5fb70391ad0d6344f75a4aa95a1478c415c83002496a90ba95a73398f513a5',
      ],
      [
        { kind: 'callRegion', parentFrameKey: parent, regionId },
        'sha256:2dbcdeb10757e1072192ce4e96f79886cbd5a0a6041758a1e42d5c5bd751e0c4',
      ],
      [
        { kind: 'parallel', parentFrameKey: parent, nodeId },
        'sha256:8be158fac46a7c96850539448853a2c9e662f23c3a7273353449d729d6ed4789',
      ],
      [
        { kind: 'parallelBranch', parentFrameKey: parent, regionId, branchKey: 'a' },
        'sha256:3de2513b42b8fcccd23cceb57935215f3e194ec6280e2b7973e84f0ca21c53c4',
      ],
      [
        { kind: 'repeat', parentFrameKey: parent, nodeId },
        'sha256:cdd11c66bbb6b5381a457133973413d6b9c5b64e3a8dd9fd1b88e0e634b397fb',
      ],
      [
        { kind: 'repeatBody', parentFrameKey: parent, regionId, ordinal: 0 },
        'sha256:4cb2a0ebea5d27819ccec3953c54a82815b26bfcaca92592bc474f6bf322b003',
      ],
      [
        { kind: 'map', parentFrameKey: parent, nodeId },
        'sha256:fb9d7d0ec925637402117233312efdb984784a9c088ec4913b52067f6a345039',
      ],
      [
        { kind: 'mapItem', parentFrameKey: parent, regionId, itemKey: 'a' },
        'sha256:ebe582824e1bbe99fabf9b183b021f85b9c24c70009a734a11827276a9d44243',
      ],
    ] as const;
    expect(vectors.map(([payload]) => computeFrameKey(payload))).toEqual(
      vectors.map(([, expected]) => expected),
    );

    const event = {
      kind: 'activityCancelled' as const,
      commandKey: kernelDigest('5'),
      ref: { programDigest: kernelDigest(), frameKey: parent, nodeId },
    };
    expect(computeEventDigest(event)).toBe(
      'sha256:04347d1bd63fa8ac90fa491e71040f22f6b5696a2f120b7cc181dec4d5a1ab3b',
    );
  });

  it('orders cancellation, dispatch, and terminal commands by priority', () => {
    const ref = {
      programDigest: kernelDigest(),
      frameKey: kernelDigest('1'),
      nodeId: '$pipeline' as const,
    };
    const cancel = cancelPendingCommand(ref, [kernelDigest('4')], 'USER');
    const dispatch = dispatchActivityCommand(ref, 'agent', {}, emptySchema());
    const fail = failCommand(ref, { code: 'FAILED', path: '' });
    const complete = completeCommand(ref, 'ok', {});
    const terminalCancel = cancelCommand(ref, 'USER');
    if (
      cancel === null ||
      dispatch === null ||
      fail === null ||
      complete === null ||
      terminalCancel === null
    ) {
      throw new TypeError('Expected canonical commands.');
    }
    expect(canonicalCommands([fail, dispatch, cancel]).map(({ kind }) => kind)).toEqual([
      'cancelPending',
      'dispatchActivity',
      'fail',
    ]);
    expect(canonicalCommands([terminalCancel, fail, complete]).map(({ kind }) => kind)).toEqual([
      'complete',
      'fail',
      'cancel',
    ]);

    const otherFail = failCommand(
      { ...ref, frameKey: kernelDigest('2') },
      { code: 'FAILED', path: '' },
    );
    if (otherFail === null) {
      throw new TypeError('Expected the comparison command.');
    }
    expect(compareCommands(fail, otherFail)).not.toBe(0);
    expect(compareCommands(fail, { ...fail, key: kernelDigest('f') })).not.toBe(0);
    expect(compareCommands(fail, fail)).toBe(0);
  });

  it('orders all seven command kinds by the normative priorities', () => {
    const commands = pipelineCommandExamples();
    expect(canonicalCommands(commands).map(({ kind }) => kind)).toEqual([
      'cancelPending',
      'dispatchActivity',
      'scheduleWait',
      'scheduleWait',
      'openHumanGate',
      'complete',
      'fail',
      'cancel',
    ]);
  });
});
