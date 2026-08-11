import type { DiagnosticCollector, JsonPointer } from '../../foundation/index.js';
import type { HumanGateSourceNode, SourceRegion } from '../contracts/index.js';
import { nestedPath } from '../internal.js';
import { isPipelineFailureSchema } from '../value-schema/index.js';

export const validateExitClassifications = (
  child: SourceRegion,
  classifications: readonly { readonly outcome: string; readonly classification: string }[],
  childPath: JsonPointer,
  classificationsPath: JsonPointer,
  collector: DiagnosticCollector,
): void => {
  const outcomes = child.exits.map(({ outcome }) => outcome);
  const classified = classifications.map(({ outcome }) => outcome);
  if (JSON.stringify(outcomes) !== JSON.stringify(classified)) {
    collector.add('CANONICAL_INPUT', classificationsPath);
  }
  for (const classification of classifications) {
    if (classification.classification !== 'failed') {
      continue;
    }
    const index = child.exits.findIndex(({ outcome }) => outcome === classification.outcome);
    const exit = child.exits[index];
    if (exit !== undefined && !isPipelineFailureSchema(exit.outputSchema)) {
      collector.add('DATA_FAILED_EXIT_SCHEMA', nestedPath(childPath, 'exits', String(index)));
    }
  }
};

export const validateGateBijection = (
  node: HumanGateSourceNode,
  path: JsonPointer,
  collector: DiagnosticCollector,
): void => {
  const answers = node.answers;
  const routes = node.routes.answers.map(({ answer }) => answer);
  if (
    new Set(answers).size !== answers.length ||
    new Set(routes).size !== routes.length ||
    JSON.stringify(answers) !== JSON.stringify(routes)
  ) {
    collector.add('SOURCE_GATE_ANSWER_BIJECTION', path);
  }
};
