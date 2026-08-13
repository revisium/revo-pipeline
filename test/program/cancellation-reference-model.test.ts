import { describe, expect, it } from 'vitest';

import { acknowledgementWork, reverseIndexWork } from '../../src/program/index.js';
import {
  literalAckWork,
  literalHypergraph,
  permutations,
} from '../support/admission-reference-model.js';

describe('independent cancellation hypergraph enumeration', () => {
  it('exhausts tiny cancellation sets and every acknowledgement order', () => {
    for (let setCount = 0; setCount <= 3; setCount += 1) {
      for (let tokenCount = 0; tokenCount <= 3; tokenCount += 1) {
        for (let mask = 0; mask < 2 ** (setCount * tokenCount); mask += 1) {
          const sets = Array.from({ length: setCount }, (unusedSet, set) =>
            Array.from({ length: tokenCount }, (unusedToken, token) => token).filter(
              (token) => (mask & (1 << (set * tokenCount + token))) !== 0,
            ),
          ).filter((set) => set.length > 0);
          const reference = literalHypergraph(sets, tokenCount);
          expect(reverseIndexWork(reference.envelope)).toBe(reference.reverseWork);
          for (const order of permutations(
            Array.from({ length: tokenCount }, (_, token) => token),
          )) {
            const mutable = sets.map((set) => new Set(set));
            for (const token of order) {
              expect(literalAckWork(mutable, token)).toBeLessThanOrEqual(
                acknowledgementWork(reference.envelope),
              );
            }
          }
        }
      }
    }
  });
});
