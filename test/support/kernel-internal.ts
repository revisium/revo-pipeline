export { createMachineFault } from '../../src/kernel/contracts/fault-factory.js';
export { advanceBaseKernel, initializeBaseKernel } from '../../src/kernel/execution/base-engine.js';
export type {
  BaseBoundaryResult,
  BaseEngineResult,
  BaseRejectedResult,
  BaseTerminalResult,
} from '../../src/kernel/execution/base-types.js';
export {
  cancelCommand,
  cancelPendingCommand,
  completeCommand,
  dispatchActivityCommand,
  failCommand,
} from '../../src/kernel/execution/commands.js';
export {
  choiceMatches,
  resolveMapping,
  resolveSelector,
  type SelectorEnvironment,
} from '../../src/kernel/execution/selectors.js';
export {
  canonicalCommands,
  compareCommands,
  computeCommandKey,
  computeEventDigest,
  computeFrameKey,
} from '../../src/kernel/identity/digests.js';
export {
  findModule,
  findNode,
  resolveBaseRegion,
  type LookupCounters,
} from '../../src/kernel/program/lookup.js';
export {
  inspectKernelProgram,
  type ProgramValidationCounters,
} from '../../src/kernel/program/validation.js';
export {
  insertCanonicalNodeResult,
  type NodeResultOrderingCounters,
} from '../../src/kernel/state/node-results.js';
export { hydratePipelineState } from '../../src/kernel/state/hydration.js';
