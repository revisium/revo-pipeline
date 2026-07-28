import { expect, test } from 'vitest';

import {
  runPackageVerificationPhasesForTest,
  type PackageVerificationPhaseSeams,
} from '../../../scripts/verify-package.js';

interface LifecycleRunner {
  readonly dispose: () => void;
}

const runnerFor = (dispose: () => void): LifecycleRunner => ({ dispose });

const primaryPhases = [
  'sourcePreparation',
  'pack',
  'extract',
  'prepareAccess',
  'metadataAndDeclarations',
  'typeCompilation',
  'runtimeConsumer',
  'assertComplete',
] as const satisfies readonly (keyof PackageVerificationPhaseSeams)[];

const phasesFor = (
  failingPhase: (typeof primaryPhases)[number] | undefined,
  primary: Error | undefined,
  calls: string[],
): PackageVerificationPhaseSeams => {
  const step = (phase: (typeof primaryPhases)[number]) => (): void => {
    calls.push(phase);
    if (phase === failingPhase && primary) {
      throw primary;
    }
  };
  return {
    sourcePreparation: step('sourcePreparation'),
    pack: step('pack'),
    extract: step('extract'),
    prepareAccess: step('prepareAccess'),
    metadataAndDeclarations: step('metadataAndDeclarations'),
    typeCompilation: step('typeCompilation'),
    runtimeConsumer: step('runtimeConsumer'),
    assertComplete: step('assertComplete'),
  };
};

test.each(primaryPhases)(
  'preserves the exact %s primary failure when cleanup succeeds',
  async (phase) => {
    const primary = new Error(`${phase} failed`);
    let disposals = 0;
    const calls: string[] = [];
    await expect(
      runPackageVerificationPhasesForTest(
        runnerFor(() => {
          disposals += 1;
        }),
        phasesFor(phase, primary, calls),
      ),
    ).rejects.toBe(primary);
    expect(disposals).toBe(1);
    expect(calls).toEqual(primaryPhases.slice(0, primaryPhases.indexOf(phase) + 1));
  },
);

test.each(primaryPhases)(
  'preserves ordered %s and cleanup failures in one AggregateError',
  async (phase) => {
    const primary = new Error(`${phase} failed`);
    const cleanup = new Error('cleanup failed');
    let disposals = 0;
    const calls: string[] = [];
    const failure = await runPackageVerificationPhasesForTest(
      runnerFor(() => {
        disposals += 1;
        throw cleanup;
      }),
      phasesFor(phase, primary, calls),
    ).then(
      () => new Error('Expected package verification to fail.'),
      (error: unknown) => error,
    );
    if (!(failure instanceof AggregateError)) {
      throw failure;
    }
    expect(failure).toMatchObject({ message: '[package-verification-and-cleanup]' });
    expect(failure.errors).toEqual([primary, cleanup]);
    expect(disposals).toBe(1);
    expect(calls).toEqual(primaryPhases.slice(0, primaryPhases.indexOf(phase) + 1));
  },
);

test('returns success after one cleanup and surfaces a cleanup-only failure unchanged', async () => {
  let successfulDisposals = 0;
  const successfulCalls: string[] = [];
  await expect(
    runPackageVerificationPhasesForTest(
      runnerFor(() => {
        successfulDisposals += 1;
      }),
      phasesFor(undefined, undefined, successfulCalls),
    ),
  ).resolves.toBeUndefined();
  expect(successfulDisposals).toBe(1);
  expect(successfulCalls).toEqual(primaryPhases);

  const cleanup = new Error('[package-cleanup]');
  await expect(
    runPackageVerificationPhasesForTest(
      runnerFor(() => {
        throw cleanup;
      }),
      phasesFor(undefined, undefined, []),
    ),
  ).rejects.toBe(cleanup);
});
