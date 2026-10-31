export type Component = 'dashboard' | 'coordinator' | 'characters';
export interface CandidateManifest {
  schema: 1;
  id: string;
  createdAt: string;
  sourceHash: string;
  /** Release base and source branch captured when this executable was built. */
  displayVersion?: string;
  commit?: string;
  dirty?: boolean;
  dependencyId?: string;
  components: Record<Component, string>;
  files: Record<string, string>;
}
export interface Candidate { manifest: CandidateManifest; directory: string }
export type CandidateSummary = Omit<CandidateManifest, 'files'>;
export type DeploymentMode = 'now' | 'safe' | 'main';
export const deploymentPending = (phase: DeploymentJournal['phase']) => !['complete', 'failed'].includes(phase);
export interface References { active?: string; latest?: string; previous?: string }
export interface DeploymentJournal {
  id: string;
  target: string;
  previous?: string;
  startedAt: string;
  phase: 'preparing' | 'waiting-safe' | 'moving-main' | 'activating' | 'resuming' | 'rolling-back' | 'complete' | 'failed';
  mode?: DeploymentMode;
  phaseStartedAt?: string;
  timings?: Partial<Record<DeploymentJournal['phase'], string>>;
  changed?: Component[];
  participants?:string[];
  waiting?:string[];
  error?: string;
}
/** Methods acknowledge actual component readiness, never merely successful spawn.
 * Activation/restore must honor cancellation before changing additional code.
 * State, credentials and configuration remain outside candidate directories. */
export interface DeploymentDriver {
  beginMaintenance?(operation: DeploymentJournal, signal: AbortSignal): Promise<void>;
  prepare?(candidate: Candidate, previous: Candidate | undefined, operation: DeploymentJournal, signal: AbortSignal): Promise<void>;
  waitUntilSafe?(id: string, signal: AbortSignal, mode?: DeploymentMode): Promise<void>;
  releaseSafeWait?(id: string): Promise<void>;
  activate(candidate: Candidate, previous: Candidate | undefined, signal: AbortSignal): Promise<void>;
  restore(candidate: Candidate | undefined, signal: AbortSignal): Promise<void>;
}
export interface ConsoleBuildStatus extends References {
  building?: boolean;
  buildError?: string;
  available?: string;
  pendingBuildCount?: number;
  operation?: DeploymentJournal;
  builds: CandidateSummary[];
  cave?: boolean;
}
