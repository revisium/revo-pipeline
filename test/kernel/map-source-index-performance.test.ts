import { Compile } from 'typebox/compile';
import { describe, expect, it } from 'vitest';

import {
  advancePipeline,
  createInitialPipelineState,
  PipelineStateSchema,
} from '../../src/kernel/index.js';
import { reverseNestedKeyMapProgram } from '../support/large-map-builders.js';
import { commandForItem } from '../support/structured-kernel-builders.js';

describe('maximum map source-index performance', () => {
  const stateValidator = Compile(PipelineStateSchema);

  it('refills a reverse 1,024-item C1 map across serialized hydration boundaries', () => {
    const itemCount = 1_024;
    const bundle = reverseNestedKeyMapProgram(itemCount);
    const initial = createInitialPipelineState(bundle, {});
    let state = initial.state;
    let commands = initial.commands;
    for (let ordinal = 0; ordinal < itemCount; ordinal += 1) {
      const cloned: unknown = JSON.parse(JSON.stringify(state));
      if (!stateValidator.Check(cloned)) {
        throw new TypeError(`Expected serialized refill state at item ${ordinal}.`);
      }
      const itemKey = `item-${String(ordinal).padStart(4, '0')}`;
      const command = commandForItem(cloned, commands, itemKey);
      const advanced = advancePipeline(bundle, cloned, {
        kind: 'activitySucceeded',
        commandKey: command.key,
        ref: command.ref,
        output: {},
      });
      state = advanced.state;
      commands = advanced.commands;
    }
    expect({ state, commands }).toMatchObject({
      state: { status: 'succeeded', frames: [], pending: [] },
      commands: [{ kind: 'complete' }],
    });
  }, 150_000);
});
