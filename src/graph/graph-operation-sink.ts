import type { GraphOperationKind } from './graph-operation-kind.js';

export type GraphOperationSink = {
  readonly add: (kind: GraphOperationKind, count: number) => void;
};
