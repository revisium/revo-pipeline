import {
  PACKAGE_CONSUMER_CASES,
  type ConsumerCase,
  type ConsumerCaseId,
} from './package-consumer-catalog.js';

export interface DocumentationSource {
  readonly path: string;
  readonly content: string;
}

export interface ExtractedDocumentationExample {
  readonly caseId: ConsumerCaseId;
  readonly source: string;
}

const expectedPublicValues = Object.freeze([
  'compilePipeline',
  'decidePipeline',
  'decodeCompiledPipeline',
  'definePipeline',
  'reducePipeline',
]);

const expectedNodeKinds = Object.freeze(['task', 'terminal']);

const documentationCases = (): readonly ConsumerCase[] =>
  Object.freeze(PACKAGE_CONSUMER_CASES.filter((entry) => entry.documentation !== null));

const sameValues = (actual: readonly string[], expected: readonly string[]): boolean =>
  actual.length === expected.length &&
  [...actual].sort().every((value, index) => value === expected[index]);

const assertTraceability = (cases: readonly ConsumerCase[]): void => {
  const publicValues = [
    ...new Set(cases.flatMap((entry) => entry.documentation?.publicValues ?? [])),
  ];
  const nodeKinds = [...new Set(cases.flatMap((entry) => entry.documentation?.nodeKinds ?? []))];
  if (
    !sameValues(publicValues, expectedPublicValues) ||
    !sameValues(nodeKinds, expectedNodeKinds)
  ) {
    throw new Error('[package-documentation-traceability]');
  }
};

const markerPattern = /<!-- package-example:(start|end):([^\s<>]+) -->/gu;

const sourceFor = (entry: ConsumerCase, document: DocumentationSource): string => {
  const start = `<!-- package-example:start:${entry.id} -->`;
  const end = `<!-- package-example:end:${entry.id} -->`;
  const markers = [...document.content.matchAll(markerPattern)];
  if (
    markers.length !== 2 ||
    markers[0]?.[0] !== start ||
    markers[1]?.[0] !== end ||
    document.content.split('<!-- package-example:').length - 1 !== markers.length
  ) {
    throw new Error('[package-documentation-marker]');
  }
  const startOffset = markers[0].index;
  const endOffset = markers[1].index;
  if (startOffset < 0 || endOffset <= startOffset) {
    throw new Error('[package-documentation-marker]');
  }
  const enclosed = document.content.slice(startOffset + start.length, endOffset).trim();
  const matched = enclosed.match(/^```ts\n([\s\S]*\S)\n```$/u);
  if (!matched?.[1] || (enclosed.match(/^```ts$/gmu) ?? []).length !== 1) {
    throw new Error('[package-documentation-marker]');
  }
  return matched[1];
};

export const extractDocumentationExamples = (
  documents: readonly DocumentationSource[],
): readonly ExtractedDocumentationExample[] => {
  const cases = documentationCases();
  assertTraceability(cases);
  if (documents.length !== cases.length) {
    throw new Error('[package-documentation-source]');
  }
  const byPath = new Map(documents.map((document) => [document.path, document]));
  const expectedPaths = cases.map((entry) => entry.documentation?.documentPath);
  if (
    byPath.size !== documents.length ||
    documents.some((document) => !expectedPaths.includes(document.path))
  ) {
    throw new Error('[package-documentation-source]');
  }
  const examples = cases.map((entry) => {
    const documentation = entry.documentation;
    const document = documentation ? byPath.get(documentation.documentPath) : undefined;
    if (!documentation || !document) {
      throw new Error('[package-documentation-source]');
    }
    return Object.freeze({ caseId: entry.id, source: sourceFor(entry, document) });
  });
  return Object.freeze(examples);
};
