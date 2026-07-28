import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';

import { validateReducerBounds } from '../../../scripts/architecture/validate-reducer-bounds.js';

const source = () => ({
  assembly: readFileSync('src/transition/reduction/assemble-pipeline-reduction.ts', 'utf8'),
  commandReplay: readFileSync('src/transition/command/classify-command-replay.ts', 'utf8'),
  drain: readFileSync('src/transition/reduction/drain-pipeline.ts', 'utf8'),
  effectDelta: readFileSync('src/transition/reduction/validate-effect-delta.ts', 'utf8'),
});

test('accepts exact 513/514 decision and 514/515 effect frontiers', () => {
  expect(() => validateReducerBounds(source())).not.toThrow();
});

test.each([
  ['while (state.applications < 514)', 'while (state.applications < 513)'],
  ['while (state.applications < 514)', 'while (state.applications < 515)'],
  ['if (state.applications > 513)', 'if (state.applications > 512)'],
  ['if (state.applications > 513)', 'if (state.applications > 514)'],
] as const)('rejects a decision-bound mutant: %s', (from, to) => {
  const sources = source();
  expect(() =>
    validateReducerBounds({ ...sources, drain: sources.drain.replace(from, to) }),
  ).toThrow('[reducer-step-bound]');
});

test.each([
  [
    'comment decoy',
    (value: string) =>
      value
        .replace('while (state.applications < 514)', 'while (state.applications < 513)')
        .concat('\n// while (state.applications < 514) {}\n'),
  ],
  [
    'dead-function decoy',
    (value: string) =>
      value
        .replace('while (state.applications < 514)', 'while (state.applications < 513)')
        .concat('\nconst decoy = () => { while (state.applications < 514) {} };\n'),
  ],
  [
    'nested decoy',
    (value: string) =>
      value.replace(
        'while (state.applications < 514) {',
        'while (state.applications < 513) { if (false) { while (state.applications < 514) {} }',
      ),
  ],
  [
    'inverted comparison',
    (value: string) =>
      value.replace('if (state.applications > 513)', 'if (513 < state.applications)'),
  ],
  [
    'guard before increment',
    (value: string) =>
      value.replace(
        'state.applications += 1;\n    if (state.applications > 513)',
        'if (state.applications > 513)',
      ),
  ],
  [
    'intervening statement',
    (value: string) =>
      value.replace(
        'state.applications += 1;\n    if (state.applications > 513)',
        'state.applications += 1;\n    void state;\n    if (state.applications > 513)',
      ),
  ],
  [
    'missing fault',
    (value: string) =>
      value.replace(
        "faults.add(\n        'REDUCTION_STEP_LIMIT',\n        '/reduction/steps',\n        'Pipeline reduction step limit exceeded.',\n      );",
        'void faults;',
      ),
  ],
  [
    'missing guard return',
    (value: string) =>
      value.replace(
        "'Pipeline reduction step limit exceeded.',\n      );\n      return undefined;",
        "'Pipeline reduction step limit exceeded.',\n      );",
      ),
  ],
  [
    'missing loop termination',
    (value: string) => value.replace('\n  return undefined;\n};', '\n};'),
  ],
] as const)('rejects a non-live decision proof: %s', (_name, mutate) => {
  const sources = source();
  expect(() => validateReducerBounds({ ...sources, drain: mutate(sources.drain) })).toThrow(
    '[reducer-step-bound]',
  );
});

test.each([
  [
    'boolean bypass',
    (value: string) =>
      value.replace(
        'if (!validateEffectDelta(state, application))',
        'if (false && !validateEffectDelta(state, application))',
      ),
  ],
  [
    'nested dead call',
    (value: string) =>
      value.replace(
        'if (!validateEffectDelta(state, application))',
        'if (false) { validateEffectDelta(state, application); }\n  if (false)',
      ),
  ],
  [
    'missing invariant fault',
    (value: string) =>
      value.replace(
        "faults.add('REDUCTION_INVARIANT', '/reduction/effects', 'Effect and state delta disagree.');",
        'void faults;',
      ),
  ],
  [
    'missing failure return',
    (value: string) =>
      value.replace('return { ok: false, faults: faults.finish() };', 'void faults.finish();'),
  ],
] as const)('rejects an assembly validation bypass: %s', (_name, mutate) => {
  const sources = source();
  expect(() => validateReducerBounds({ ...sources, assembly: mutate(sources.assembly) })).toThrow(
    '[reducer-effect-bound]',
  );
});

test.each([
  [
    'off by one',
    (value: string) =>
      value.replace(
        'snapshot.values.length + values.length > 128',
        'snapshot.values.length + values.length > 129',
      ),
  ],
  [
    'boolean bypass',
    (value: string) =>
      value.replace(
        'if (snapshot.values.length + values.length > 128)',
        'if (false && snapshot.values.length + values.length > 128)',
      ),
  ],
  [
    'comment decoy',
    (value: string) =>
      value
        .replace(
          'snapshot.values.length + values.length > 128',
          'snapshot.values.length + values.length > 129',
        )
        .concat('\n// snapshot.values.length + values.length > 128\n'),
  ],
  [
    'dead-function decoy',
    (value: string) =>
      value
        .replace(
          'snapshot.values.length + values.length > 128',
          'snapshot.values.length + values.length > 129',
        )
        .concat('\nconst prospectiveDecoy = () => snapshot.values.length + values.length > 128;\n'),
  ],
  [
    'non-dominating moved guard',
    (value: string) =>
      value.replace(
        'if (snapshot.values.length + values.length > 128)',
        'void values;\n  if (snapshot.values.length + values.length > 128)',
      ),
  ],
  [
    'lifecycle bypass',
    (value: string) =>
      value.replace("if (node?.state !== 'enabled')", "if (false && node?.state !== 'enabled')"),
  ],
  [
    'lifecycle comment decoy',
    (value: string) =>
      value
        .replace("if (node?.state !== 'enabled')", 'if (false)')
        .concat("\n// if (node?.state !== 'enabled')\n"),
  ],
] as const)('rejects a prospective command-value guard mutant: %s', (_name, mutate) => {
  const sources = source();
  expect(() =>
    validateReducerBounds({
      ...sources,
      commandReplay: mutate(sources.commandReplay),
    }),
  ).toThrow('[reducer-command-value-bound]');
});

test.each([
  ['state.effects.length > 514', 'state.effects.length > 513'],
  ['state.effects.length > 514', 'state.effects.length > 515'],
] as const)('rejects an effect-bound mutant: %s', (from, to) => {
  const sources = source();
  expect(() =>
    validateReducerBounds({
      ...sources,
      effectDelta: sources.effectDelta.replace(from, to),
    }),
  ).toThrow('[reducer-effect-bound]');
});

test.each([
  [
    'comment decoy',
    (value: string) =>
      value
        .replace('state.effects.length > 514', 'state.effects.length > 515')
        .concat('\n// state.effects.length > 514\n'),
  ],
  [
    'dead-function decoy',
    (value: string) =>
      value
        .replace('state.effects.length > 514', 'state.effects.length > 515')
        .concat('\nconst effectDecoy = () => state.effects.length > 514;\n'),
  ],
  [
    'inverted comparison',
    (value: string) => value.replace('state.effects.length > 514', '514 < state.effects.length'),
  ],
  [
    'guard moved after replay',
    (value: string) => {
      const guard =
        "if (state.effects.length > 514 || (application === 'unchanged' && state.effects.length !== 0)) {\n    return false;\n  }\n";
      return value
        .replace(guard, '')
        .replace(
          'state.effects.forEach((effect) => applyEffect(shadow, effect));',
          (line) => `${line}\n  ${guard}`,
        );
    },
  ],
] as const)('rejects a non-live effect proof: %s', (_name, mutate) => {
  const sources = source();
  expect(() =>
    validateReducerBounds({ ...sources, effectDelta: mutate(sources.effectDelta) }),
  ).toThrow('[reducer-effect-bound]');
});

test.each([
  'initialize',
  'completeTask',
  'recordConsensusVerdict',
  'resolveHumanGate',
  'completeSelector',
  'activateNode',
  'terminatePipeline',
] as const)('rejects removal of the %s effect-to-delta arm', (kind) => {
  const sources = source();
  expect(() =>
    validateReducerBounds({
      ...sources,
      effectDelta: sources.effectDelta.replace(`effect.kind === '${kind}'`, 'false'),
    }),
  ).toThrow('[reducer-effect-bound]');
});
