import { isDigest, type Digest } from '../foundation/index.js';

const runIdentity = (prefix: string, id: Digest): string => `${prefix}_${id.slice(7)}`;

export const pipelineIdentity = (id: string): string | null =>
  isDigest(id) ? runIdentity('pipeline', id) : null;

export const choiceIdentity = (id: string): string | null =>
  isDigest(id) ? runIdentity('choice', id) : null;
