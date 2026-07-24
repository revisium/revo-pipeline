import type { AllJoinPolicy } from './all-join-policy.js';
import type { AnyJoinPolicy } from './any-join-policy.js';
import type { ThresholdJoinPolicy } from './threshold-join-policy.js';

export type JoinPolicy = AllJoinPolicy | AnyJoinPolicy | ThresholdJoinPolicy;
