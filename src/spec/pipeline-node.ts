import type { BranchNode } from './branch-node.js';
import type { ConsensusNode } from './consensus-node.js';
import type { ForkNode } from './fork-node.js';
import type { HumanGateNode } from './human-gate-node.js';
import type { JoinNode } from './join-node.js';
import type { TaskNode } from './task-node.js';
import type { TerminalNode } from './terminal-node.js';

export type PipelineNode =
  | TaskNode
  | BranchNode
  | ForkNode
  | JoinNode
  | ConsensusNode
  | HumanGateNode
  | TerminalNode;
