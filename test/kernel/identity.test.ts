import { describe, expect, it } from 'vitest';

import { kernelDigest } from '../support/kernel-builders.js';
import {
  pipelineCommandExamples,
  pipelineEventExamples,
} from '../support/kernel-contract-examples.js';
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
  normalizeEvent,
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

  it('covers base structural payload domains with pinned digests', () => {
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
    ] as const;
    expect(vectors.map(([payload]) => computeFrameKey(payload))).toEqual(
      vectors.map(([, expected]) => expected),
    );
  });

  it('pins structured digest payloads', () => {
    const parentFrameKey = kernelDigest('2');
    const nodeId = kernelDigest('4');
    const vectors = [
      [
        { kind: 'parallel', parentFrameKey, nodeId },
        'sha256:8be158fac46a7c96850539448853a2c9e662f23c3a7273353449d729d6ed4789',
      ],
      [
        { kind: 'repeat', parentFrameKey, nodeId },
        'sha256:cdd11c66bbb6b5381a457133973413d6b9c5b64e3a8dd9fd1b88e0e634b397fb',
      ],
      [
        { kind: 'map', parentFrameKey, nodeId },
        'sha256:fb9d7d0ec925637402117233312efdb984784a9c088ec4913b52067f6a345039',
      ],
    ] as const;
    expect(vectors.map(([payload]) => computeFrameKey(payload))).toEqual(
      vectors.map(([, expected]) => expected),
    );
  });

  it('pins exact structured frame and event golden vectors', () => {
    const parentFrameKey = kernelDigest('2');
    const regionId = kernelDigest('3');
    const nodeId = kernelDigest('4');
    const vectors = [
      [
        { kind: 'parallelBranch', parentFrameKey, regionId, branchKey: 'a' },
        'sha256:3de2513b42b8fcccd23cceb57935215f3e194ec6280e2b7973e84f0ca21c53c4',
      ],
      [
        { kind: 'repeatBody', parentFrameKey, regionId, ordinal: 0 },
        'sha256:4cb2a0ebea5d27819ccec3953c54a82815b26bfcaca92592bc474f6bf322b003',
      ],
      [
        { kind: 'mapItem', parentFrameKey, regionId, itemKey: 'a' },
        'sha256:ebe582824e1bbe99fabf9b183b021f85b9c24c70009a734a11827276a9d44243',
      ],
    ] as const;
    expect(vectors.map(([payload]) => computeFrameKey(payload))).toEqual(
      vectors.map(([, expected]) => expected),
    );

    const event = {
      kind: 'activityCancelled' as const,
      commandKey: kernelDigest('5'),
      ref: { programDigest: kernelDigest(), frameKey: parentFrameKey, nodeId },
    };
    expect(computeEventDigest(event)).toBe(
      'sha256:04347d1bd63fa8ac90fa491e71040f22f6b5696a2f120b7cc181dec4d5a1ab3b',
    );
  });

  it('pins all eleven normalized event digest vectors across terminal contexts', () => {
    const expected = [
      'sha256:58273761eaa78661bcf00a3533f7b05d9fa46b53f1a5ef11ae1b24283f0de98d',
      'sha256:7301f7ddf279f92086ce31d132e6c68b02ff0a6acce30b02267da1ca6260f44e',
      'sha256:4d0c8b4746a951990f15e7510927175bc7fad8616539941f82c89f752f0917b9',
      'sha256:73d65e9344c83ebb6d4c3d6413bcba78bed52ba668ded3d4b35cc6949a3b9aa4',
      'sha256:b3a0ded2a6cea87b29483f25d5662ac77fc279fdc6e53320be5fe0401d9a67d7',
      'sha256:3873a0b122cac2c5ae0d0ffcd6d0973a0e75992518439424a5c9a90e80f06a5f',
      'sha256:7113c4015d356a291e46dc977e1ee10cab5957cb27177c9b6cdd0d90c06303b6',
      'sha256:0e9c28adfc0ac6e59e8d622aef5969b0f707ae52e77463615098be18a168defd',
      'sha256:bd8afa3a400d6c39e0a9814744ef68b7d5b24ca1aee379707eee5c83b50a1d0f',
      'sha256:63b63e9adfed698f52c2d99b756b5897b65caa8a0a25ec0c643a156468ecf2fb',
      'sha256:7880df513052a4fb0f7d74eaa366ed33884938748410492ed9c08c3be2e93c59',
    ];
    const normalized = pipelineEventExamples().map(normalizeEvent);
    expect(normalized.every(({ ok }) => ok)).toBe(true);
    expect(normalized.map((result) => (result.ok ? result.normalized.eventDigest : null))).toEqual(
      expected,
    );
  });

  it('pins all eight command key vectors across seven kinds and both wait variants', () => {
    const expected = [
      'sha256:52fffa6648ebe3143a1af3bd13307f0ac547bd671c9d5cc4539af2be5cf76c95',
      'sha256:6444302cbdfd2320b9f20156112dd4aed3d972499332d47ec8475acf5e8b52cf',
      'sha256:33b9681e3d64190bc76e8d82a9b5a5f30ce1fac85b92e3e44308056025665a3c',
      'sha256:33b9681e3d64190bc76e8d82a9b5a5f30ce1fac85b92e3e44308056025665a3c',
      'sha256:73dc3c258d197e726ce393768917d97c931d7272f90f1c7423a43eb229780c55',
      'sha256:e67daa6d0102bd0c99b0a5339bf86b73c9de7997bfdf95b46e2e3be2dc788286',
      'sha256:6c42c54a5c1805137ae282ebdafc26173a347bbfc5c0924373f0f716d4cae94b',
      'sha256:be8bf0b26e80399dfbdfbc0535cc464fcfcfd8d1a1ee684b1646849020330a31',
    ];
    expect(pipelineCommandExamples().map(({ kind, ref }) => computeCommandKey(kind, ref))).toEqual(
      expected,
    );
  });

  it('separates identity axes from excluded host and command payload context', () => {
    const [activity] = pipelineEventExamples();
    const commands = pipelineCommandExamples();
    const duration = commands.find(
      (command) => command.kind === 'scheduleWait' && command.wait.kind === 'duration',
    );
    const signal = commands.find(
      (command) => command.kind === 'scheduleWait' && command.wait.kind === 'signal',
    );
    const failed = commands.find((command) => command.kind === 'fail');
    if (
      activity?.kind !== 'activitySucceeded' ||
      duration === undefined ||
      signal === undefined ||
      failed === undefined
    ) {
      throw new TypeError('Expected stable identity context examples.');
    }
    expect(normalizeEvent({ ...activity, runId: 'host', timestamp: 1 })).toEqual({
      ok: false,
      code: 'EVENT_SCHEMA',
    });
    expect(computeEventDigest({ ...activity, output: { changed: true } })).not.toBe(
      computeEventDigest(activity),
    );
    expect(computeCommandKey(duration.kind, duration.ref)).toBe(
      computeCommandKey(signal.kind, signal.ref),
    );
    expect(failed.path).toBe('');
    expect(computeCommandKey(failed.kind, failed.ref)).not.toBe(
      computeCommandKey(failed.kind, { ...failed.ref, frameKey: kernelDigest('9') }),
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
