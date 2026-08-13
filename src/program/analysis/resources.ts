import { countJsonValues, type ValueSchema } from '../../foundation/index.js';
import type { PipelineProgram, ProgramNode, ProgramRegion } from '../contracts/index.js';
import {
  EMPTY_CANCELLATION_ENVELOPE,
  alternativeCancellation,
  disjointCancellation,
  overlayCancellation,
  type CancellationEnvelope,
} from './cancellation-envelope.js';
import { PROGRAM_ADMISSION_LIMITS } from './limits.js';
import { valueSchemaWeight } from './value-weight.js';

export type ProgramResourceEnvelope = {
  readonly frames: number;
  readonly operations: number;
  readonly nodeResults: number;
  readonly collectionSlots: number;
  readonly cancellation: CancellationEnvelope;
  readonly stateJsonValues: number;
  readonly commandJsonValues: number;
};

const cap = (value: number, limit: number): number => Math.min(value, limit + 1);
const capFrames = (value: number): number => cap(value, PROGRAM_ADMISSION_LIMITS.liveFrames);
const capOperations = (value: number): number =>
  cap(value, PROGRAM_ADMISSION_LIMITS.liveOperations);
const capResults = (value: number): number => cap(value, PROGRAM_ADMISSION_LIMITS.nodeResults);
const capSlots = (value: number): number => cap(value, PROGRAM_ADMISSION_LIMITS.collectionSlots);
const capState = (value: number): number => cap(value, PROGRAM_ADMISSION_LIMITS.stateJsonValues);
const stateProduct = (left: number, right: number): number =>
  capState(capState(left) * capState(right));
const capCommands = (value: number): number =>
  cap(value, PROGRAM_ADMISSION_LIMITS.commandJsonValues);

const empty = (): ProgramResourceEnvelope =>
  Object.freeze({
    frames: 0,
    operations: 0,
    nodeResults: 0,
    collectionSlots: 0,
    cancellation: EMPTY_CANCELLATION_ENVELOPE,
    stateJsonValues: 0,
    commandJsonValues: 0,
  });

const maximum = (values: readonly ProgramResourceEnvelope[]): ProgramResourceEnvelope => {
  if (values.length === 0) {
    return empty();
  }
  return Object.freeze({
    frames: Math.max(...values.map(({ frames }) => frames)),
    operations: Math.max(...values.map(({ operations }) => operations)),
    nodeResults: Math.max(...values.map(({ nodeResults }) => nodeResults)),
    collectionSlots: Math.max(...values.map(({ collectionSlots }) => collectionSlots)),
    cancellation: alternativeCancellation(values.map(({ cancellation }) => cancellation)),
    stateJsonValues: Math.max(...values.map(({ stateJsonValues }) => stateJsonValues)),
    commandJsonValues: Math.max(...values.map(({ commandJsonValues }) => commandJsonValues)),
  });
};

const concurrent = (values: readonly ProgramResourceEnvelope[]): ProgramResourceEnvelope =>
  values.reduce<ProgramResourceEnvelope>(
    (total, value) =>
      Object.freeze({
        frames: capFrames(total.frames + value.frames),
        operations: capOperations(total.operations + value.operations),
        nodeResults: capResults(total.nodeResults + value.nodeResults),
        collectionSlots: capSlots(total.collectionSlots + value.collectionSlots),
        cancellation: disjointCancellation(total.cancellation, value.cancellation),
        stateJsonValues: capState(total.stateJsonValues + value.stateJsonValues),
        commandJsonValues: capCommands(total.commandJsonValues + value.commandJsonValues),
      }),
    empty(),
  );

const schemaDocumentWeight = (schema: ValueSchema): number =>
  countJsonValues(schema, PROGRAM_ADMISSION_LIMITS.commandJsonValues);

const commandWeight = (node: ProgramNode): number => {
  if (node.kind === 'activity') {
    return 10 + valueSchemaWeight(node.inputSchema) + schemaDocumentWeight(node.outputSchema);
  }
  if (node.kind === 'wait') {
    return (
      10 +
      (node.wait.kind === 'signal' && node.wait.payloadSchema !== null
        ? schemaDocumentWeight(node.wait.payloadSchema)
        : 0)
    );
  }
  if (node.kind === 'humanGate') {
    return 10 + node.answers.length + node.authorizationRequirements.length;
  }
  return 0;
};

const nodeOutputWeight = (node: ProgramNode): number => {
  switch (node.kind) {
    case 'activity':
      return valueSchemaWeight(node.outputSchema);
    case 'call':
      return valueSchemaWeight(node.outputSchema);
    case 'repeat':
      return valueSchemaWeight(node.outputSchema);
    case 'wait':
      return node.wait.kind === 'signal' && node.wait.payloadSchema !== null
        ? valueSchemaWeight(node.wait.payloadSchema)
        : 1;
    case 'humanGate':
      return 5;
    case 'parallel':
      return 4 + node.branches.length * 6;
    case 'map':
      return capState(
        2 + stateProduct(node.maximumItems, 4 + Math.max(1, completedMapOutputWeight(node))),
      );
    case 'choice':
    case 'end':
      return 0;
  }
  node satisfies never;
  throw new TypeError('Unexpected Program node kind.');
};

const completedMapOutputWeight = (node: Extract<ProgramNode, { readonly kind: 'map' }>): number => {
  const completedOutcomes = new Set<string>();
  for (const exit of node.bodyExits) {
    if (exit.classification === 'completed') {
      completedOutcomes.add(exit.outcome);
    }
  }
  let maximumWeight = 0;
  for (const exit of node.body.exits) {
    if (!completedOutcomes.has(exit.outcome)) {
      continue;
    }
    maximumWeight = Math.max(maximumWeight, valueSchemaWeight(exit.outputSchema));
  }
  return maximumWeight;
};

type ResourceContext = {
  readonly modules: ReadonlyMap<string, ProgramResourceEnvelope>;
  readonly region: (region: ProgramRegion) => ProgramResourceEnvelope;
};

const nodeResources = (node: ProgramNode, context: ResourceContext): ProgramResourceEnvelope => {
  if (node.kind === 'activity' || node.kind === 'wait' || node.kind === 'humanGate') {
    const weight = commandWeight(node);
    return Object.freeze({
      frames: 0,
      operations: 1,
      nodeResults: 0,
      collectionSlots: 2,
      cancellation: EMPTY_CANCELLATION_ENVELOPE,
      stateJsonValues: 8,
      commandJsonValues: weight,
    });
  }
  if (node.kind === 'call') {
    const child = context.modules.get(node.module) ?? empty();
    return Object.freeze({
      ...child,
      frames: capFrames(child.frames + 1),
      collectionSlots: capSlots(child.collectionSlots + 3),
      stateJsonValues: capState(child.stateJsonValues + valueSchemaWeight(node.outputSchema) + 10),
    });
  }
  if (node.kind === 'parallel') {
    const branches = concurrent(node.branches.map(({ region }) => context.region(region)));
    const cancellation =
      node.remaining === 'cancel'
        ? overlayCancellation(branches.cancellation, branches.operations)
        : branches.cancellation;
    return Object.freeze({
      frames: capFrames(branches.frames + 1),
      operations: branches.operations,
      nodeResults: branches.nodeResults,
      collectionSlots: capSlots(branches.collectionSlots + 2 * node.branches.length + 3),
      cancellation,
      stateJsonValues: capState(branches.stateJsonValues + 8 * node.branches.length + 12),
      commandJsonValues: capCommands(
        branches.commandJsonValues + (node.remaining === 'cancel' ? 10 + branches.operations : 0),
      ),
    });
  }
  if (node.kind === 'repeat') {
    const body = context.region(node.body);
    return Object.freeze({
      ...body,
      frames: capFrames(body.frames + 1),
      collectionSlots: capSlots(body.collectionSlots + 3),
      stateJsonValues: capState(body.stateJsonValues + valueSchemaWeight(node.outputSchema) + 12),
    });
  }
  if (node.kind === 'map') {
    const body = context.region(node.body);
    const active = Math.min(node.maximumItems, node.maximumConcurrency);
    const bodies = concurrent(Array.from({ length: active }, () => body));
    const mayCancel = node.failure.kind === 'failFast' && node.failure.remaining === 'cancel';
    const outputWeight = completedMapOutputWeight(node);
    const itemRecordWeight = Math.max(7, 4 + outputWeight);
    const cancellation = mayCancel
      ? overlayCancellation(bodies.cancellation, bodies.operations)
      : bodies.cancellation;
    return Object.freeze({
      frames: capFrames(bodies.frames + 1),
      operations: bodies.operations,
      nodeResults: bodies.nodeResults,
      collectionSlots: capSlots(bodies.collectionSlots + 5 * node.maximumItems + 4),
      cancellation,
      stateJsonValues: capState(
        bodies.stateJsonValues + 15 + stateProduct(node.maximumItems, 4 + itemRecordWeight),
      ),
      commandJsonValues: capCommands(
        bodies.commandJsonValues + (mayCancel ? 10 + bodies.operations : 0),
      ),
    });
  }
  return empty();
};

const regionResources = (
  region: ProgramRegion,
  modules: ReadonlyMap<string, ProgramResourceEnvelope>,
): ProgramResourceEnvelope => {
  const context: ResourceContext = {
    modules,
    region: (child) => regionResources(child, modules),
  };
  const child = maximum(region.nodes.map((node) => nodeResources(node, context)));
  const retainedResultValues = region.nodes.reduce(
    (total, node) => capState(total + 3 + nodeOutputWeight(node)),
    0,
  );
  return Object.freeze({
    frames: capFrames(child.frames + 1),
    operations: child.operations,
    nodeResults: capResults(region.nodes.length + child.nodeResults),
    collectionSlots: capSlots(region.nodes.length * 2 + child.collectionSlots + 1),
    cancellation: child.cancellation,
    stateJsonValues: capState(
      12 + valueSchemaWeight(region.inputSchema) + retainedResultValues + child.stateJsonValues,
    ),
    commandJsonValues: child.commandJsonValues,
  });
};

export const measureProgramResources = (
  program: PipelineProgram,
  dependencyOrder: readonly string[],
): ProgramResourceEnvelope => {
  const modulesByKey = new Map(program.modules.map((module) => [module.key, module]));
  const measured = new Map<string, ProgramResourceEnvelope>();
  for (const key of dependencyOrder) {
    const module = modulesByKey.get(key);
    if (module !== undefined) {
      measured.set(key, regionResources(module.region, measured));
    }
  }
  return maximum([...measured.values()]);
};
