import type { PipelineForkRelation } from '../../spec/index.js';
import type { DecisionContext } from '../context/decision-context.js';

export const deriveForkRelation = (
  nodeKey: string,
  context: DecisionContext,
): PipelineForkRelation => {
  const joined = context.regionByJoin.get(nodeKey);
  if (joined) {
    return { kind: 'join', forkNodeKey: joined.fork, joinNodeKey: joined.join, role: 'join' };
  }
  const forkKey = context.regionOwnerByNode.get(nodeKey);
  const region = forkKey ? context.regionByFork.get(forkKey) : undefined;
  if (!region) {
    return { kind: 'none' };
  }
  const branch = region.branches.find((item) => item.members.includes(nodeKey));
  if (!branch) {
    return { kind: 'none' };
  }
  const entry = branch.entry === nodeKey;
  const exit = branch.exit === nodeKey;
  let role: 'entryExit' | 'entry' | 'exit' | 'member' = 'member';
  if (entry && exit) {
    role = 'entryExit';
  } else if (entry) {
    role = 'entry';
  } else if (exit) {
    role = 'exit';
  }
  return {
    kind: 'branch',
    forkNodeKey: region.fork,
    joinNodeKey: region.join,
    branch: branch.name,
    role,
  };
};
