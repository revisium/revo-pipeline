export type WaitReason =
  | 'task-incomplete'
  | 'branch-fact-missing'
  | 'join-incomplete'
  | 'consensus-incomplete'
  | 'gate-unresolved';
