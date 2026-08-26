#!/usr/bin/env node

import {
  compilePipeline,
  computeProgramDigest,
  computeSourceDigest,
  definePipelineSource,
} from '@revisium/revo-pipeline';
import {
  advancePipeline,
  createInitialPipelineState,
  type PipelineCommand,
} from '@revisium/revo-pipeline/kernel';

const emptyObject = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

const agentInput = {
  type: 'object',
  properties: { prompt: { type: 'string' } },
  required: ['prompt'],
  additionalProperties: false,
} as const;

const source = definePipelineSource({
  schemaVersion: 'pipeline-source/v1',
  key: 'quick-start',
  entryModule: 'main',
  maximumTotalActivities: 8,
  modules: [
    {
      key: 'main',
      inputSchema: agentInput,
      outputSchema: emptyObject,
      region: {
        key: 'root',
        inputSchema: agentInput,
        entry: 'first',
        outputSchema: emptyObject,
        exits: [{ outcome: 'ok', outputSchema: emptyObject }],
        nodes: [
          {
            kind: 'agent',
            id: 'first',
            strategies: [
              {
                kind: 'single',
                routes: { succeeded: 'second', failed: 'terminal', cancelled: 'terminal' },
              },
            ],
            input: { prompt: { kind: 'scopeInput', pointer: '/prompt' } },
            inputSchema: agentInput,
            outputSchema: emptyObject,
          },
          {
            kind: 'script',
            id: 'second',
            requirementKey: 'quick-start-script',
            script: { id: 'script:quick-start-script', version: 1 },
            input: {},
            inputSchema: emptyObject,
            outputSchema: emptyObject,
            routes: { succeeded: 'terminal', failed: 'terminal', cancelled: 'terminal' },
          },
          { kind: 'end', id: 'terminal', outcome: 'ok', output: {} },
        ],
      },
    },
  ],
});

const sourceDigest = computeSourceDigest(source);
const compiled = compilePipeline(source, {
  first: {
    strategy: 'single',
    participant: { key: 'reviewer', bindingKey: 'reviewer-binding' },
  },
});
if (!compiled.ok) {
  throw new Error(`Quick-start compilation failed: ${JSON.stringify(compiled.diagnostics)}`);
}

const programDigest = computeProgramDigest({
  program: compiled.program,
  requirements: compiled.requirements,
  provenance: compiled.provenance,
});
if (programDigest !== compiled.programDigest) {
  throw new Error('Quick-start Program digest does not match compiler output.');
}

const bundle = { program: compiled.program, programDigest };
const initial = createInitialPipelineState(bundle, { prompt: 'Review the quick-start pipeline.' });
const firstCommand = initial.commands.find(
  (command): command is Extract<PipelineCommand, { readonly kind: 'dispatchActivity' }> =>
    command.kind === 'dispatchActivity',
);
if (firstCommand === undefined) {
  throw new Error('Expected the agent activity command.');
}
const firstEvent = {
  kind: 'activitySucceeded' as const,
  commandKey: firstCommand.key,
  ref: firstCommand.ref,
  output: {},
};
const first = advancePipeline(bundle, initial.state, firstEvent);
if (first.kind !== 'advanced') {
  throw new Error(`Agent activity failed: ${JSON.stringify(first.faults)}`);
}

const replay = advancePipeline(bundle, first.state, firstEvent);
if (replay.kind !== 'advanced' || replay.state !== first.state || replay.commands.length !== 0) {
  throw new Error('Identical agent-event delivery was not idempotent.');
}

const secondCommand = first.commands.find(
  (command): command is Extract<PipelineCommand, { readonly kind: 'dispatchActivity' }> =>
    command.kind === 'dispatchActivity',
);
if (secondCommand === undefined) {
  throw new Error('Expected the script activity command.');
}
const completed = advancePipeline(bundle, first.state, {
  kind: 'activitySucceeded',
  commandKey: secondCommand.key,
  ref: secondCommand.ref,
  output: {},
});
if (completed.kind !== 'advanced' || completed.state.status !== 'succeeded') {
  throw new Error('Quick-start pipeline did not complete.');
}

console.log(
  `REVO_PIPELINE_DIGEST_VECTORS=${JSON.stringify({
    sourceDigest,
    materializationDigest: compiled.materializationDigest,
    programDigest,
  })}`,
);
