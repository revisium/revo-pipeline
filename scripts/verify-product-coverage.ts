import { readFile, readdir, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const fail = (message: string): never => {
  throw new Error(`Product coverage verification failed: ${message}`);
};

const canonicalPath = (path: string): string => {
  const repositoryPath = relative(root, resolve(root, path));
  if (
    repositoryPath === '' ||
    repositoryPath === '..' ||
    repositoryPath.startsWith(`..${sep}`) ||
    repositoryPath.includes('\0')
  ) {
    return fail(`path escapes repository: ${path}`);
  }
  return repositoryPath.split(sep).join('/');
};

const collectProductionFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail(`symbolic link is not allowed in production inventory: ${canonicalPath(path)}`);
      }
      if (entry.isDirectory()) {
        return collectProductionFiles(path);
      }
      if (entry.isFile() && entry.name.endsWith('.ts')) {
        return [canonicalPath(await realpath(path))];
      }
      return [];
    }),
  );
  return nestedFiles.flat().sort();
};

const lcov = await readFile(resolve(root, 'coverage/lcov.info'), 'utf8').catch((error: unknown) =>
  fail(`cannot read coverage/lcov.info: ${error instanceof Error ? error.message : String(error)}`),
);
const records = lcov
  .split('end_of_record')
  .map((record) => record.trim())
  .filter((record) => record.length > 0);
if (records.length === 0) {
  fail('LCOV report is empty');
}

const coveredFiles = new Set<string>();
let lineData = 0;
let functionData = 0;
let branchData = 0;
for (const record of records) {
  const lines = record.split(/\r?\n/u);
  const sourceLines = lines.filter((line) => line.startsWith('SF:'));
  if (sourceLines.length !== 1) {
    fail('LCOV record must contain exactly one SF entry');
  }
  const sourceLine = sourceLines[0] ?? fail('LCOV record is missing its SF entry');
  const path = canonicalPath(sourceLine.slice(3));
  if (!path.startsWith('src/') || !path.endsWith('.ts')) {
    fail(`non-production coverage record: ${path}`);
  }
  if (coveredFiles.has(path)) {
    fail(`duplicate LCOV record: ${path}`);
  }
  coveredFiles.add(path);

  for (const line of lines) {
    if (line.startsWith('DA:')) {
      if (!/^DA:\d+,\d+(?:,[^,]+)?$/u.test(line)) {
        fail(`malformed line coverage entry in ${path}: ${line}`);
      }
      lineData += 1;
    } else if (line.startsWith('FN:') || line.startsWith('FNDA:')) {
      if (!/^(?:FN:\d+,.+|FNDA:\d+,.+)$/u.test(line)) {
        fail(`malformed function coverage entry in ${path}: ${line}`);
      }
      functionData += 1;
    } else if (line.startsWith('BRDA:')) {
      if (!/^BRDA:\d+,\d+,\d+,(?:\d+|-)$/u.test(line)) {
        fail(`malformed branch coverage entry in ${path}: ${line}`);
      }
      branchData += 1;
    }
  }
}

const productionFiles = await collectProductionFiles(resolve(root, 'src'));
const reportFiles = [...coveredFiles].sort();
if (JSON.stringify(reportFiles) !== JSON.stringify(productionFiles)) {
  const missing = productionFiles.filter((file) => !coveredFiles.has(file));
  const unexpected = reportFiles.filter((file) => !productionFiles.includes(file));
  fail(
    `LCOV boundary mismatch; missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}]`,
  );
}
if (lineData === 0 || functionData === 0 || branchData === 0) {
  fail(
    `LCOV report lacks Sonar data: lines=${String(lineData)}, functions=${String(functionData)}, branches=${String(branchData)}`,
  );
}

console.log(
  `Product coverage verified: ${String(reportFiles.length)} src files; ${String(lineData)} line, ${String(functionData)} function, ${String(branchData)} branch entries.`,
);
