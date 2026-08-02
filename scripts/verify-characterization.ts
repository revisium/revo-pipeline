import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { compilePipeline, decidePipeline } from '../src/index.js';
import type { PipelineDecision, PipelineDefinition, PipelineFacts } from '../src/index.js';
import { evaluateProperties } from '../test/characterization/evaluate-properties.js';

const root = resolve(import.meta.dirname, '..');
const characterization = resolve(root, 'test/characterization');
const baseSha = 'c5dafd574269c230e4921614a481fc7277f2ff00';
const acceptedProductionTreeSha256 =
  'ed752ef65c754585f44a582e20fe3f6f24dd3388b5c53b0ea1193c39da4286a6';
const acceptedRootDigest = '3f98846bd74ed4875f3b2e14d701ec2a36c320c4e00db9d5dbf54b017d4bed10';
const acceptedFrontierFixtureSha256 =
  '452d61513245cbb479e046113627f6c52583c92d37633d460379f1450a466654';
const acceptedValidFrontierCount = 94;
const acceptedExcludedFrontierCount = 119;
const implementationPaths = {
  capture: 'test/characterization/capture-characterization.ts',
  verifier: 'scripts/verify-characterization.ts',
  propertyEvaluator: 'test/characterization/evaluate-properties.ts',
} as const;
const acceptedGraphFlowDigests = {
  owners: {
    'src/definition/compile-pipeline.ts#compilePipeline':
      '5e601cebbdf06ebe1882a7a46b2ce1485ed27c331eafd94b4eca0362259c1669',
    'src/definition/compile-pipeline.ts#preflightForkRegions':
      'f619d28422ddc193db794b6be3a10d851215cf271c135128f71f16be5aac5528',
    'src/definition/compile-pipeline.ts#classifyForkRegions':
      'd4e293cc77b4548642ee22f8a3d18e4f079c829bd57ff08df5f2527a82f44eb1',
    'src/transition/validate-compiled-internally.ts#validateCompiledInternally':
      'a67ae89bf1609012ca61ddb8af71d4d1977fb706a7fd5b5c716374677630aed6',
    'src/transition/validate-compiled-internally.ts#canonicalCoreGraph':
      '14bd423f973be6e501259781a512d0c217154189f53bd4e8561e914a9cc25267',
    'src/transition/validate-compiled-internally.ts#canonicalRegions':
      '7ed0e7ad7eccc190c19b6fefb899144d300c095d1fa0c55b221a5cfbbcdc3b9a',
    'src/transition/validate-compiled-internally.ts#independentlyDerivedRegionMembers':
      'e34e5e22da2f182384cbffd75ade50e4aa25f194e8c9805033e9e9d9dd9cd084',
  },
  files: {
    'src/definition/compile-pipeline.ts':
      'f061385d4fa3ee91972301b589afc0a9a5c16de4ed00d2cab322011ce6f63acc',
    'src/transition/validate-compiled-internally.ts':
      'dff379567b2b2fac80d733e248f806182788127c13f7dece9959ed76f7a8958d',
  },
} as const;

type Artifact = { readonly path: string; readonly sha256: string };
type Manifest = {
  readonly formatVersion: 1;
  readonly provenance: {
    readonly pr3Sha: string;
    readonly implementationBriefSha256: string;
    readonly schemas: Record<string, number>;
    readonly node: string;
    readonly pnpm: string;
    readonly productionTreeSha256: string;
    readonly graphFlowDigests: {
      readonly owners: Record<string, string>;
      readonly files: Record<string, string>;
    };
  };
  readonly artifacts: readonly Artifact[];
  readonly implementation: {
    readonly capture: Artifact;
    readonly verifier: Artifact;
    readonly propertyEvaluator: Artifact;
  };
  readonly rootDigest: string;
};
type CompilerCase = { readonly id: string; readonly definition: PipelineDefinition };
type DecisionCase = CompilerCase & { readonly facts: PipelineFacts };
type FrontierFixture = { readonly formatVersion: 1; readonly valid: readonly string[] };

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
const fail = (message: string): never => {
  throw new Error(`Characterization verification failed: ${message}`);
};
const equal = (actual: unknown, expected: unknown, label: string): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} behavior drifted`);
  }
};
const isCompilerCase = (value: unknown): value is CompilerCase =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof value.id === 'string' &&
  'definition' in value &&
  typeof value.definition === 'object' &&
  value.definition !== null;
const isDecisionCase = (value: unknown): value is DecisionCase =>
  isCompilerCase(value) &&
  'facts' in value &&
  typeof value.facts === 'object' &&
  value.facts !== null;
const requireCases = <T>(
  value: unknown,
  predicate: (item: unknown) => item is T,
  label: string,
): readonly T[] => {
  if (!Array.isArray(value) || !value.every(predicate)) {
    return fail(`invalid ${label}`);
  }
  return value;
};
const isArtifact = (value: unknown): value is Artifact =>
  typeof value === 'object' &&
  value !== null &&
  'path' in value &&
  typeof value.path === 'string' &&
  'sha256' in value &&
  typeof value.sha256 === 'string';
const isManifest = (value: unknown): value is Manifest =>
  typeof value === 'object' &&
  value !== null &&
  'formatVersion' in value &&
  value.formatVersion === 1 &&
  'provenance' in value &&
  typeof value.provenance === 'object' &&
  value.provenance !== null &&
  'pr3Sha' in value.provenance &&
  typeof value.provenance.pr3Sha === 'string' &&
  'implementationBriefSha256' in value.provenance &&
  typeof value.provenance.implementationBriefSha256 === 'string' &&
  'schemas' in value.provenance &&
  typeof value.provenance.schemas === 'object' &&
  value.provenance.schemas !== null &&
  'node' in value.provenance &&
  typeof value.provenance.node === 'string' &&
  'pnpm' in value.provenance &&
  typeof value.provenance.pnpm === 'string' &&
  'productionTreeSha256' in value.provenance &&
  typeof value.provenance.productionTreeSha256 === 'string' &&
  'graphFlowDigests' in value.provenance &&
  typeof value.provenance.graphFlowDigests === 'object' &&
  value.provenance.graphFlowDigests !== null &&
  'owners' in value.provenance.graphFlowDigests &&
  typeof value.provenance.graphFlowDigests.owners === 'object' &&
  value.provenance.graphFlowDigests.owners !== null &&
  'files' in value.provenance.graphFlowDigests &&
  typeof value.provenance.graphFlowDigests.files === 'object' &&
  value.provenance.graphFlowDigests.files !== null &&
  'artifacts' in value &&
  Array.isArray(value.artifacts) &&
  value.artifacts.every(isArtifact) &&
  'implementation' in value &&
  typeof value.implementation === 'object' &&
  value.implementation !== null &&
  'capture' in value.implementation &&
  isArtifact(value.implementation.capture) &&
  'verifier' in value.implementation &&
  isArtifact(value.implementation.verifier) &&
  'propertyEvaluator' in value.implementation &&
  isArtifact(value.implementation.propertyEvaluator) &&
  'rootDigest' in value &&
  typeof value.rootDigest === 'string';
const requireManifest = (value: unknown): Manifest => {
  if (!isManifest(value)) {
    return fail('invalid manifest shape');
  }
  return value;
};
const isFrontierFixture = (value: unknown): value is FrontierFixture =>
  typeof value === 'object' &&
  value !== null &&
  'formatVersion' in value &&
  value.formatVersion === 1 &&
  'valid' in value &&
  Array.isArray(value.valid) &&
  value.valid.every((identity) => typeof identity === 'string');
const requireFrontierFixture = (value: unknown): FrontierFixture => {
  if (!isFrontierFixture(value)) {
    return fail('invalid reference frontier fixture');
  }
  return value;
};

const subset = <T>(values: readonly T[], mask: number): readonly T[] =>
  values.filter((_value, index) => (mask & (1 << index)) !== 0);

export const assertPermanentFrontierDecision = (decision: PipelineDecision): void => {
  if (decision.kind === 'noop') {
    fail('reference frontier emitted noop');
  }
  if (
    (decision.kind === 'activate' && decision.nodeKeys.length === 0) ||
    (decision.kind === 'select' && decision.activate.length === 0)
  ) {
    fail('reference frontier emitted empty activation');
  }
};

export const assertReferenceClassification = (
  referenceValid: boolean,
  decision: PipelineDecision,
): void => {
  const causalRejection =
    decision.kind === 'reject' &&
    decision.faults.some(({ code }) => code === 'FACT_CAUSAL' || code === 'FACT_PREMATURE');
  if (referenceValid && causalRejection) {
    fail('reference-valid frontier received causal rejection');
  }
  if (!referenceValid && !causalRejection) {
    fail('reference-excluded frontier missed causal rejection');
  }
  if (referenceValid) {
    assertPermanentFrontierDecision(decision);
  }
};

const verifyReferenceFrontiers = (
  cases: readonly DecisionCase[],
  validIdentities: ReadonlySet<string>,
): { readonly valid: number; readonly excluded: number } => {
  const reviewed = new Set<string>();
  let valid = 0;
  let excluded = 0;
  for (const { id, definition, facts } of cases) {
    const compilation = compilePipeline(definition);
    if (!compilation.ok) {
      continue;
    }
    for (let valuesMask = 0; valuesMask < 2 ** facts.values.length; valuesMask += 1) {
      for (let nodesMask = 0; nodesMask < 2 ** facts.nodes.length; nodesMask += 1) {
        for (
          let candidateMask = 0;
          candidateMask < 2 ** facts.candidateVerdicts.length;
          candidateMask += 1
        ) {
          for (let gateMask = 0; gateMask < 2 ** facts.gateResolutions.length; gateMask += 1) {
            const identity = `${id}:${valuesMask}:${nodesMask}:${candidateMask}:${gateMask}`;
            const decision = decidePipeline(compilation.pipeline, {
              values: subset(facts.values, valuesMask),
              nodes: subset(facts.nodes, nodesMask),
              candidateVerdicts: subset(facts.candidateVerdicts, candidateMask),
              gateResolutions: subset(facts.gateResolutions, gateMask),
            });
            const referenceValid = validIdentities.has(identity);
            assertReferenceClassification(referenceValid, decision);
            reviewed.add(identity);
            if (referenceValid) {
              valid += 1;
            } else {
              excluded += 1;
            }
          }
        }
      }
    }
  }
  if ([...validIdentities].some((identity) => !reviewed.has(identity))) {
    fail('reference frontier fixture contains unknown identity');
  }
  return { valid, excluded };
};

const manifest = requireManifest(await readJson(resolve(characterization, 'manifest.json')));
if (
  sha256(await readFile(resolve(characterization, 'corpus/inputs/frontiers.json'))) !==
  acceptedFrontierFixtureSha256
) {
  fail('reference frontier fixture digest drifted');
}
if (
  manifest.formatVersion !== 1 ||
  manifest.provenance.pr3Sha !== baseSha ||
  manifest.provenance.implementationBriefSha256 !==
    '32f42beb2194e8a4c06317ff871fd102354c9022a72500a693174d8747950933'
) {
  fail('invalid corpus format or PR3 provenance');
}
if (
  JSON.stringify(manifest.provenance.schemas) !==
    JSON.stringify({ pipelineDefinition: 1, compiledPipeline: 1, pipelineFacts: 1 }) ||
  manifest.provenance.node !== '>=24.11.1 <25' ||
  manifest.provenance.pnpm !== '11.13.0'
) {
  fail('schema or toolchain provenance drifted');
}
if (manifest.provenance.productionTreeSha256 !== acceptedProductionTreeSha256) {
  fail('production tree provenance drifted');
}
if (
  JSON.stringify(manifest.provenance.graphFlowDigests) !== JSON.stringify(acceptedGraphFlowDigests)
) {
  fail('graph-flow digest inventory drifted');
}
if (manifest.rootDigest !== acceptedRootDigest) {
  fail('accepted corpus root drifted');
}
for (const name of ['capture', 'verifier', 'propertyEvaluator'] as const) {
  if (manifest.implementation[name].path !== implementationPaths[name]) {
    fail(`${name} implementation path drifted`);
  }
}

const sortedPaths = manifest.artifacts.map(({ path }) => path).toSorted();
if (new Set(sortedPaths).size !== sortedPaths.length) {
  fail('duplicate artifact path');
}
if (JSON.stringify(sortedPaths) !== JSON.stringify(manifest.artifacts.map(({ path }) => path))) {
  fail('artifact paths are not sorted');
}
const actualPaths = (
  await Promise.all(
    ['inputs', 'outputs'].map(async (directory) =>
      (await readdir(resolve(characterization, `corpus/${directory}`))).map(
        (name) => `corpus/${directory}/${name}`,
      ),
    ),
  )
)
  .flat()
  .sort();
if (JSON.stringify(actualPaths) !== JSON.stringify(sortedPaths)) {
  fail('missing or extra artifact');
}

const artifactDigests = await Promise.all(
  manifest.artifacts.map(async (artifact) => ({
    artifact,
    actual: sha256(await readFile(resolve(characterization, artifact.path))),
  })),
);
for (const { artifact, actual } of artifactDigests) {
  if (actual !== artifact.sha256) {
    fail(`${artifact.path} digest drifted`);
  }
}
if (
  sha256(await readFile(resolve(root, manifest.implementation.capture.path))) !==
  manifest.implementation.capture.sha256
) {
  fail('capture digest drifted');
}
if (
  sha256(await readFile(resolve(root, manifest.implementation.verifier.path))) !==
  manifest.implementation.verifier.sha256
) {
  fail('verifier digest drifted');
}
if (
  sha256(await readFile(resolve(root, manifest.implementation.propertyEvaluator.path))) !==
  manifest.implementation.propertyEvaluator.sha256
) {
  fail('property evaluator digest drifted');
}
const rootDigest = sha256(
  manifest.artifacts.map(({ path, sha256: digest }) => `${path}\0${digest}`).join(''),
);
if (rootDigest !== manifest.rootDigest) {
  fail('root digest drifted');
}

const compilerCases = requireCases(
  await readJson(resolve(characterization, 'corpus/inputs/compiler.json')),
  isCompilerCase,
  'compiler inputs',
);
const compilerExpected = await readJson(resolve(characterization, 'corpus/outputs/compiler.json'));
equal(
  compilerCases.map(({ id, definition }) => ({ id, output: compilePipeline(definition) })),
  compilerExpected,
  'compiler',
);

const decisionCases = requireCases(
  await readJson(resolve(characterization, 'corpus/inputs/decisions.json')),
  isDecisionCase,
  'decision inputs',
);
const decisions = decisionCases.map(({ id, definition, facts }) => {
  const compilation = compilePipeline(definition);
  return {
    id,
    compilation,
    decision: compilation.ok ? decidePipeline(compilation.pipeline, facts) : compilation,
  };
});
const frontierFixture = requireFrontierFixture(
  await readJson(resolve(characterization, 'corpus/inputs/frontiers.json')),
);
if (
  frontierFixture.valid.length !== acceptedValidFrontierCount ||
  new Set(frontierFixture.valid).size !== acceptedValidFrontierCount
) {
  fail('reference valid frontier identity set drifted');
}
const referenceFrontierCounts = verifyReferenceFrontiers(
  [
    ...decisionCases,
    ...compilerCases.map(({ id, definition }) => ({
      id: `compiler:${id}`,
      definition,
      facts: { values: [], nodes: [], candidateVerdicts: [], gateResolutions: [] },
    })),
  ],
  new Set(frontierFixture.valid),
);
if (
  referenceFrontierCounts.valid !== acceptedValidFrontierCount ||
  referenceFrontierCounts.excluded !== acceptedExcludedFrontierCount
) {
  fail('reference frontier counts drifted');
}
equal(
  decisions,
  await readJson(resolve(characterization, 'corpus/outputs/decisions.json')),
  'decision',
);
const propertyIds = requireCases(
  await readJson(resolve(characterization, 'corpus/inputs/properties.json')),
  (value): value is string => typeof value === 'string',
  'property inputs',
);
equal(
  evaluateProperties(propertyIds),
  await readJson(resolve(characterization, 'corpus/outputs/properties.json')),
  'property matrix',
);
console.log(
  `Characterization reference frontiers verified: ${referenceFrontierCounts.valid} valid, ${referenceFrontierCounts.excluded} excluded`,
);
