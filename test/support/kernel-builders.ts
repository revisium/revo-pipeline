import type { Digest, ValueSchema } from '../../src/foundation/index.js';
import type {
  InitialPipelineTransition,
  KernelProgram,
  PipelineCommand,
  PipelineTransition,
} from '../../src/kernel/index.js';
import type {
  PipelineProgram,
  ProgramModule,
  ProgramNode,
  ProgramNodeId,
  ProgramRegion,
} from '../../src/program/index.js';
import { programId } from './program-builders.js';
import { emptySchema } from './source-builders.js';

export const kernelDigest = (digit = '0'): Digest => `sha256:${digit.repeat(64)}`;

type AcceptedTransition =
  | InitialPipelineTransition
  | Extract<PipelineTransition, { readonly kind: 'advanced' }>;
type RejectedTransition = Extract<PipelineTransition, { readonly kind: 'rejected' }>;

export const runningResult = (
  result: InitialPipelineTransition | PipelineTransition,
): AcceptedTransition => {
  if (
    result.kind === 'rejected' ||
    (result.state.status !== 'running' && result.state.status !== 'cancelling')
  ) {
    throw new TypeError(
      `Expected a running result, received ${result.kind}/${result.state.status}.`,
    );
  }
  return result;
};

export const terminalResult = (
  result: InitialPipelineTransition | PipelineTransition,
): AcceptedTransition => {
  if (
    result.kind === 'rejected' ||
    result.state.status === 'running' ||
    result.state.status === 'cancelling'
  ) {
    throw new TypeError(
      `Expected a terminal result, received ${result.kind}/${result.state.status}.`,
    );
  }
  return result;
};

export const rejectedResult = (result: PipelineTransition): RejectedTransition => {
  if (result.kind !== 'rejected') {
    throw new TypeError(`Expected a rejected result, received ${result.kind}.`);
  }
  return result;
};

export const activityDispatch = (
  result: AcceptedTransition,
): Extract<PipelineCommand, { readonly kind: 'dispatchActivity' }> => {
  const command = result.commands[0];
  if (command?.kind !== 'dispatchActivity') {
    throw new TypeError('Expected an activity dispatch command.');
  }
  return command;
};

export const kernelRegion = (
  nodes: readonly [ProgramNode, ...ProgramNode[]],
  options: {
    readonly id?: ProgramNodeId;
    readonly entry?: ProgramNodeId;
    readonly inputSchema?: ValueSchema;
    readonly outputSchema?: ValueSchema;
    readonly outcomes?: readonly string[];
  } = {},
): ProgramRegion => {
  const [firstOutcome, ...remainingOutcomes] = options.outcomes ?? ['ok'];
  const [firstNode, ...remainingNodes] = [...nodes].toSorted((left, right) =>
    left.id.localeCompare(right.id),
  );
  if (firstOutcome === undefined || firstNode === undefined) {
    throw new TypeError('Kernel region fixtures require an exit and a node.');
  }
  return {
    id: options.id ?? programId('f'),
    inputSchema: options.inputSchema ?? emptySchema(),
    entry: options.entry ?? nodes[0].id,
    outputSchema: options.outputSchema ?? emptySchema(),
    exits: [
      { outcome: firstOutcome, outputSchema: options.outputSchema ?? emptySchema() },
      ...remainingOutcomes.map((outcome) => ({
        outcome,
        outputSchema: options.outputSchema ?? emptySchema(),
      })),
    ],
    nodes: [firstNode, ...remainingNodes],
  };
};

export const kernelModule = (
  key: string,
  region: ProgramRegion,
  inputSchema: ValueSchema = region.inputSchema,
  outputSchema: ValueSchema = region.outputSchema,
): ProgramModule => ({ key, inputSchema, outputSchema, region });

export const kernelProgram = (
  modules: readonly [ProgramModule, ...ProgramModule[]],
  entryModule = modules[0].key,
): KernelProgram => {
  const [firstModule, ...remainingModules] = [...modules].toSorted((left, right) =>
    left.key.localeCompare(right.key),
  );
  if (firstModule === undefined) {
    throw new TypeError('Kernel Program fixtures require a module.');
  }
  const program: PipelineProgram = {
    schemaVersion: 'pipeline-program/v1',
    key: 'pipeline',
    sourceDigest: kernelDigest('a'),
    materializationDigest: kernelDigest('b'),
    entryModule,
    maximumTotalActivities: 1_000_000,
    modules: [firstModule, ...remainingModules],
  };
  return { program, programDigest: kernelDigest() };
};
