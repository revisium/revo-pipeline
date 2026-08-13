import { describe, expect, it } from 'vitest';

import {
  mapRegion,
  nestedMap,
  productionWork,
  tinyParallel,
} from '../support/admission-program-fixtures.js';
import { literalMapQueue, literalParallelQueue } from '../support/admission-reference-model.js';

describe('independent tiny frontier enumeration', () => {
  it('exhausts tiny map refill frontiers without underestimating the literal queue', () => {
    for (let items = 0; items <= 4; items += 1) {
      for (let concurrency = 1; concurrency <= 3; concurrency += 1) {
        if (concurrency > Math.max(1, items)) {
          continue;
        }
        for (let bodyWeight = 0; bodyWeight <= 4; bodyWeight += 1) {
          for (let continuationWeight = 0; continuationWeight <= 4; continuationWeight += 1) {
            const bodyWork = bodyWeight + 2;
            const continuationWork = continuationWeight + 2;
            const region = mapRegion(items, bodyWork, continuationWork, concurrency);
            expect(productionWork(region).start).toBeGreaterThanOrEqual(
              literalMapQueue(items, bodyWork, continuationWork),
            );
          }
        }
      }
    }
  });

  it('exhausts tiny nested frontiers through depth three', () => {
    for (let depth = 0; depth <= 3; depth += 1) {
      for (let weight = 0; weight <= 4; weight += 1) {
        const fixture = nestedMap(depth, weight);
        expect(productionWork(fixture.region).start).toBe(fixture.work);
      }
    }
  });

  it('exhausts zero-to-three tiny parallel sibling frontiers', () => {
    for (let count = 0; count <= 3; count += 1) {
      for (let encoded = 0; encoded < 5 ** count; encoded += 1) {
        let cursor = encoded;
        const works = Array.from({ length: count }, () => {
          const weight = cursor % 5;
          cursor = Math.floor(cursor / 5);
          return weight + 2;
        });
        expect(literalParallelQueue(works)).toBe(
          2 + works.reduce((total, work) => total + 1 + work + 2, 0) + 2,
        );
      }
    }
  });

  it('matches every valid two-to-three branch Program frontier', () => {
    for (let count = 2; count <= 3; count += 1) {
      for (let encoded = 0; encoded < 5 ** count; encoded += 1) {
        let cursor = encoded;
        const works = Array.from({ length: count }, () => {
          const weight = cursor % 5;
          cursor = Math.floor(cursor / 5);
          return weight + 2;
        });
        expect(productionWork(tinyParallel(works)).start).toBe(literalParallelQueue(works));
      }
    }
  });
});
