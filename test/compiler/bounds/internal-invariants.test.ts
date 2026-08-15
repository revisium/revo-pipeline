import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/compiler/linking/index.js', () => ({
  linkSource: () => ({
    ok: true,
    value: Object.freeze({ modulesByKey: new Map(), callsByPath: new Map() }),
  }),
}));

import { compilePipeline } from '../../../src/compiler/index.js';
import { materializationFor, singleSelection } from '../../support/compiler-builders.js';
import { agentSource } from '../../support/source-builders.js';

describe('activity-bound internal invariants', () => {
  it('throws one redacted TypeError for a null bound with no diagnostic', () => {
    const source = { ...agentSource(), key: 'private-source-secret' };
    let thrown: unknown;

    try {
      compilePipeline(source, materializationFor(source, singleSelection()));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    if (!(thrown instanceof Error)) {
      throw new TypeError('Expected an Error instance.');
    }
    expect(thrown.message).toBe('Invalid internal activity bound state.');
    expect(thrown.message).not.toContain('private-source-secret');
    expect(Object.hasOwn(thrown, 'cause')).toBe(false);
  });
});
