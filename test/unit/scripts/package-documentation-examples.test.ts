import { expect, test } from 'vitest';

import { PACKAGE_CONSUMER_CASES } from '../../../scripts/package/package-consumer-catalog.js';
import { extractDocumentationExamples } from '../../../scripts/package/package-documentation-examples.js';

const documents = (): readonly { readonly path: string; readonly content: string }[] =>
  PACKAGE_CONSUMER_CASES.flatMap((entry) => {
    if (!entry.documentation) {
      return [];
    }
    return [
      {
        path: entry.documentation.documentPath,
        content: `<!-- package-example:start:${entry.id} -->\n\`\`\`ts\nexport const ${entry.id.replaceAll('-', '_')} = true;\n\`\`\`\n<!-- package-example:end:${entry.id} -->`,
      },
    ];
  });

test('extracts the catalog-owned executable document', () => {
  const examples = extractDocumentationExamples(documents());
  expect(examples.map(({ caseId }) => caseId)).toEqual(['task-branch-terminal']);
  expect(examples.every(({ source }) => source.startsWith('export const'))).toBe(true);
});

test.each([
  (content: string) =>
    content.replace('package-example:end:task-branch-terminal', 'package-example:end:wrong'),
  (content: string) => content.replace('```ts', '```js'),
  (content: string) => content.replace('<!-- package-example:end:task-branch-terminal -->', ''),
  (content: string) =>
    content.replace(
      '<!-- package-example:start:task-branch-terminal -->',
      '<!-- package-example:end:task-branch-terminal -->',
    ),
  (content: string) => `${content}\n<!-- package-example:start:task-branch-terminal -->`,
  (content: string) =>
    content.replace('```ts', '<!-- package-example:start:unknown-case -->\n```ts'),
  (content: string) => content.replace('```ts', '<!-- package-example:start:bad id -->\n```ts'),
  (content: string) => content.replace('```ts', 'prose is not executable\n```ts'),
  (content: string) =>
    content.replace('```ts', '<!-- package-example:start:fork-join-consensus-terminal -->\n```ts'),
])('rejects malformed ordered example markers', (mutate) => {
  const source = documents().map((document) =>
    document.path === 'README.md' ? { ...document, content: mutate(document.content) } : document,
  );
  expect(() => extractDocumentationExamples(source)).toThrow('[package-documentation-marker]');
});

test('rejects a document outside the catalog-owned path', () => {
  const source = documents().map((document) => ({ ...document, path: 'docs/example.md' }));
  expect(() => extractDocumentationExamples(source)).toThrow('[package-documentation-source]');
});
