import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const verificationArgument = '--verify';
const publicationHook = 'node scripts/verify-publication-block.mjs';

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  throw new Error(`Publication block verification failed: ${message}`);
}

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @returns {Record<string, unknown>} */
function readManifest() {
  const manifestPath = join(repositoryRoot, 'package.json');
  const manifest = /** @type {unknown} */ (JSON.parse(readFileSync(manifestPath, 'utf8')));
  assert(isRecord(manifest), 'package.json must contain an object');
  return manifest;
}

/** @param {Record<string, unknown>} manifest */
function verifyManifest(manifest) {
  assert(manifest.private === true, 'package.json must set private to true');

  for (const field of ['main', 'types', 'exports', 'files', 'publishConfig']) {
    assert(!Object.hasOwn(manifest, field), `package.json must not contain ${field}`);
  }

  for (const field of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundledDependencies',
    'bundleDependencies',
  ]) {
    assert(!Object.hasOwn(manifest, field), `package.json must not contain ${field}`);
  }

  const scripts = manifest.scripts;
  assert(isRecord(scripts), 'package.json must contain scripts');
  assert(
    scripts.prepublishOnly === publicationHook,
    'prepublishOnly must invoke the fail-closed publication hook',
  );
  assert(!Object.hasOwn(scripts, 'prepack'), 'prepack must remain absent');
}

function verifyReleaseWorkflowsAreAbsent() {
  for (const workflow of ['npm-publish.yml', 'release-train.yml', 'release.yml']) {
    assert(
      !existsSync(join(repositoryRoot, '.github', 'workflows', workflow)),
      `.github/workflows/${workflow} must remain absent`,
    );
  }
}

function verifyMinimalSource() {
  const sourceRoot = join(repositoryRoot, 'src');
  const entries = readdirSync(sourceRoot, { withFileTypes: true });
  assert(
    entries.length === 1 && entries[0]?.isFile() && entries[0].name === 'index.ts',
    'src must contain only index.ts',
  );
  assert(
    readFileSync(join(sourceRoot, 'index.ts'), 'utf8') === 'export {};\n',
    'src/index.ts must expose an empty runtime surface',
  );
}

function verifyPublicationBlock() {
  verifyManifest(readManifest());
  verifyReleaseWorkflowsAreAbsent();
  verifyMinimalSource();
}

const isVerificationMode = process.argv.length === 3 && process.argv[2] === verificationArgument;

if (!isVerificationMode) {
  console.error('Publication is blocked until rp-06 conformance and readiness are complete.');
  process.exitCode = 1;
} else {
  verifyPublicationBlock();
  console.log('Publication block verified.');
}
