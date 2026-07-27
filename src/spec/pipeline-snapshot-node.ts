import type { PipelineNodeOccurrence } from './pipeline-node-occurrence.js';
import type { PipelineTerminal } from './pipeline-terminal.js';

export type PipelineSnapshotNode =
  | { readonly occurrence: PipelineNodeOccurrence; readonly state: 'enabled' }
  | {
      readonly occurrence: PipelineNodeOccurrence;
      readonly state: 'terminal';
      readonly outcome: string;
    }
  | {
      readonly occurrence: PipelineNodeOccurrence;
      readonly state: 'retired';
      readonly terminal: PipelineTerminal;
    };
