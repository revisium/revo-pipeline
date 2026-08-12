import { describe, expect, it } from 'vitest';

import {
  ConsensusParticipantRegionOutputSchema,
  VoteExitSchema,
  genericParallelOutputSchema,
  voteParallelOutputSchema,
} from '../../../src/program/index.js';
import { emptySchema } from '../../support/source-builders.js';

describe('Program-derived output schemas', () => {
  it('pins the exact consensus participant schemas', () => {
    expect(VoteExitSchema).toEqual({
      type: 'object',
      properties: { vote: { type: 'string', enum: ['abstain', 'approve', 'reject'] } },
      required: ['vote'],
      additionalProperties: false,
    });
    expect(ConsensusParticipantRegionOutputSchema).toHaveProperty('anyOf', [
      VoteExitSchema,
      expect.any(Object),
      emptySchema(),
    ]);
  });

  it('builds canonical total generic and vote records', () => {
    const generic = genericParallelOutputSchema([
      { key: 'right', completed: [{ outcome: 'ok', outputSchema: emptySchema() }] },
      { key: 'left', completed: [{ outcome: 'ok', outputSchema: emptySchema() }] },
    ]);
    const votes = voteParallelOutputSchema(['right', 'left']);
    expect('type' in generic && generic.type === 'object' ? generic.required : []).toEqual([
      'branches',
      'classification',
    ]);
    expect('type' in votes && votes.type === 'object' ? votes.required : []).toEqual([
      'classification',
      'votes',
    ]);
  });
});
