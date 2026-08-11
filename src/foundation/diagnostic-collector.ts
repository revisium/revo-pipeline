import {
  createPipelineDiagnostic,
  finalizePipelineDiagnostics,
  type PipelineDiagnostic,
  type PipelineDiagnosticCode,
} from './diagnostics.js';
import type { JsonPointer } from './json-pointer.js';

export type DiagnosticCollector = {
  readonly add: (code: PipelineDiagnosticCode, path: JsonPointer) => void;
  readonly finalize: () => readonly PipelineDiagnostic[];
};

export const createDiagnosticCollector = (): DiagnosticCollector => {
  const diagnostics: PipelineDiagnostic[] = [];
  const keys = new Set<string>();
  return Object.freeze({
    add: (code: PipelineDiagnosticCode, path: JsonPointer): void => {
      const key = `${code}\n${path}`;
      if (!keys.has(key)) {
        keys.add(key);
        diagnostics.push(createPipelineDiagnostic(code, path));
      }
    },
    finalize: (): readonly PipelineDiagnostic[] => finalizePipelineDiagnostics(diagnostics),
  });
};
