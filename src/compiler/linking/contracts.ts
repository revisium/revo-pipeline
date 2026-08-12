import type { JsonPointer } from '../../foundation/index.js';
import type { PipelineSourceModule } from '../../source/index.js';

export type LinkedCall = {
  readonly target: PipelineSourceModule;
};

export type LinkedSource = {
  readonly modulesByKey: ReadonlyMap<string, PipelineSourceModule>;
  readonly callsByPath: ReadonlyMap<JsonPointer, LinkedCall>;
};
