export type Component = 'dashboard' | 'coordinator' | 'characters';
export interface CandidateManifest {
  schema: 1;
  id: string;
  createdAt: string;
  sourceHash: string;
  commit?: string;
  dirty?: boolean;
  dependencyId?: string;
  components: Record<Component, string>;
  files: Record<string, string>;
}
export interface Candidate { manifest: CandidateManifest; directory: string }
export interface References { active?: string; latest?: string; previous?: string }
export interface DeploymentJournal {
  id: string;
  target: string;
  previous?: string;
  startedAt: string;
  phase: 'waiting-safe' | 'activating' | 'rolling-back' | 'complete' | 'failed';
  mode?: 'now' | 'safe';
  error?: string;
}
/** Methods acknowledge actual component readiness, never merely successful spawn.
 * Activation/restore must honor cancellation before changing additional code.
 * State, credentials and configuration remain outside candidate directories. */
export interface DeploymentDriver {
  waitUntilSafe?(id: string, signal: AbortSignal): Promise<void>;
  releaseSafeWait?(id: string): Promise<void>;
  activate(candidate: Candidate, previous: Candidate | undefined, signal: AbortSignal): Promise<void>;
  restore(candidate: Candidate | undefined, signal: AbortSignal): Promise<void>;
}
export interface ConsoleBuildStatus extends References {
  building?: boolean;
  buildError?: string;
  available?: string;
  operation?: DeploymentJournal;
  builds: CandidateManifest[];
}
