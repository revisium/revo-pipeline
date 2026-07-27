import type { DecisionFault, PipelineReductionFaultCode } from '../../errors/index.js';
import type { ReductionDiagnosticCollector } from '../reduction/reduction-diagnostic-collector.js';

type Collections = 'values' | 'nodes' | 'candidateVerdicts' | 'gateResolutions';

export const mergeSnapshotFactFaults = (
  input: readonly DecisionFault[],
  indexes: Readonly<Record<Collections, readonly number[]>>,
  faults: ReductionDiagnosticCollector,
): void => {
  input.forEach((fault) =>
    faults.add(
      factCode(fault.code),
      `/snapshot${originalPath(fault.path, indexes)}`,
      fault.message,
    ),
  );
};

const originalPath = (
  path: string,
  indexes: Readonly<Record<Collections, readonly number[]>>,
): string => {
  const match = /^\/(values|nodes|candidateVerdicts|gateResolutions)\/(\d+)(.*)$/u.exec(path);
  const collection = collectionName(match?.[1]);
  if (!match || !collection) {
    return path;
  }
  const projectedIndex = Number(match[2]);
  return `/${collection}/${indexes[collection][projectedIndex] ?? projectedIndex}${match[3]}`;
};

const collectionName = (value: string | undefined): Collections | undefined =>
  value === 'values' ||
  value === 'nodes' ||
  value === 'candidateVerdicts' ||
  value === 'gateResolutions'
    ? value
    : undefined;

const factCode = (code: string): PipelineReductionFaultCode => {
  const mapped: Readonly<Record<string, PipelineReductionFaultCode>> = {
    FACT_TYPE: 'SNAPSHOT_TYPE',
    FACT_LIMIT: 'SNAPSHOT_LIMIT',
    FACT_DUPLICATE: 'SNAPSHOT_DUPLICATE',
    FACT_FOREIGN: 'SNAPSHOT_FOREIGN',
    FACT_OUTCOME: 'SNAPSHOT_OUTCOME',
    FACT_CANDIDATE: 'SNAPSHOT_CANDIDATE',
    FACT_RESOLUTION: 'SNAPSHOT_RESOLUTION',
    FACT_PREMATURE: 'SNAPSHOT_PREMATURE',
    FACT_CAUSAL: 'SNAPSHOT_CAUSAL',
  };
  return mapped[code] ?? 'SNAPSHOT_SCHEMA';
};
