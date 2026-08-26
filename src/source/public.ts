import {
  compareUnicodeCodePoints,
  computeRedactedDigest,
  type Digest,
} from '../foundation/index.js';
import type { PipelineDiagnostic } from '../foundation/index.js';
import type { PipelineSourcePackage, SourceNodeId } from './contracts/index.js';
import { validatePipelineSource } from './validate.js';

export type PipelineSlotStrategyDescriptor =
  | { readonly kind: 'single' }
  | {
      readonly kind: 'consensus';
      readonly minimumParticipants: number;
      readonly maximumParticipants: number;
    };

export type PipelineSlotDescriptor = {
  readonly id: SourceNodeId;
  readonly strategies: readonly [
    PipelineSlotStrategyDescriptor,
    ...PipelineSlotStrategyDescriptor[],
  ];
};

export type PipelineSlotInspectionResult =
  | { readonly ok: true; readonly slots: readonly PipelineSlotDescriptor[] }
  | { readonly ok: false; readonly diagnostics: readonly PipelineDiagnostic[] };

export const definePipelineSource = <const Value extends PipelineSourcePackage>(
  value: Value,
): Value => value;

export const computeSourceDigest = (source: PipelineSourcePackage): Digest =>
  computeRedactedDigest(() => {
    const result = validatePipelineSource(source);
    return result.ok ? result.value.sourceDigest : null;
  });

export const inspectPipelineSlots = (
  source: PipelineSourcePackage,
): PipelineSlotInspectionResult => {
  const result = validatePipelineSource(source);
  if (!result.ok) {
    return result;
  }
  const slots = result.value.reachableAgents
    .map(({ id, strategies }) => {
      const descriptors = strategies
        .map((strategy) =>
          strategy.kind === 'single'
            ? Object.freeze({ kind: 'single' as const })
            : Object.freeze({
                kind: 'consensus' as const,
                minimumParticipants: strategy.minimumParticipants,
                maximumParticipants: strategy.maximumParticipants,
              }),
        )
        .toSorted((left, right) => compareUnicodeCodePoints(left.kind, right.kind));
      const [first, ...rest] = descriptors;
      if (first === undefined) {
        throw new TypeError('Expected schema-validated agent strategies.');
      }
      const strategyDescriptors: PipelineSlotDescriptor['strategies'] = Object.freeze([
        first,
        ...rest,
      ]);
      return Object.freeze({
        id,
        strategies: strategyDescriptors,
      });
    })
    .toSorted((left, right) => compareUnicodeCodePoints(left.id, right.id));
  return Object.freeze({ ok: true, slots: Object.freeze(slots) });
};
