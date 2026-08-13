import { compilePipeline } from '../../src/compiler/index.js';
import type { KernelProgram, PipelineCommand } from '../../src/kernel/index.js';
import type { SourceNode } from '../../src/source/index.js';
import { materializationFor } from './compiler-builders.js';
import { sourceForNode } from './source-builders.js';

export const compileStructuredNode = (node: SourceNode): KernelProgram => {
  const source = sourceForNode(node);
  const result = compilePipeline(source, materializationFor(source));
  if (!result.ok) {
    throw new TypeError(`Expected compile success: ${JSON.stringify(result.diagnostics)}`);
  }
  return { program: result.program, programDigest: result.programDigest };
};

export const commandOf = <Kind extends PipelineCommand['kind']>(
  commands: readonly PipelineCommand[],
  kind: Kind,
): Extract<PipelineCommand, { readonly kind: Kind }> => {
  const command = commands.find(
    (candidate): candidate is Extract<PipelineCommand, { readonly kind: Kind }> =>
      candidate.kind === kind,
  );
  if (command === undefined) {
    throw new TypeError(`Expected ${kind} command.`);
  }
  return command;
};
