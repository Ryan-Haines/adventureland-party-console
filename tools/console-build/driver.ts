import type { Candidate, Component, DeploymentDriver } from './contracts.ts';

export interface ActivationObservation {
  coordinator?: { artifactId: string; hash: string };
  dashboardHash?: string;
  /** Host freezes the required connected roster before applying CODE changes. */
  characters: Record<string, string>;
}
export interface ActivationPorts {
  /** Capture required connected roster once, before any component stops. */
  prepare?(signal: AbortSignal): Promise<void>;
  stopCoordinator(signal: AbortSignal): Promise<void>;
  startCoordinator(directory: string, signal: AbortSignal): Promise<void>;
  activateDashboard(directory: string, signal: AbortSignal): Promise<void>;
  /** Reload CODE only; preserve each native socket and game context. */
  reloadCharacters(directory: string, signal: AbortSignal): Promise<Record<string, string>>;
  observe(signal: AbortSignal): Promise<ActivationObservation>;
}

function check(signal: AbortSignal): void { signal.throwIfAborted(); }
function delay(signal: AbortSignal): Promise<void> {
  check(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 200);
    signal.addEventListener('abort', abort, { once: true });
  });
}
function changed(candidate: Candidate, previous?: Candidate): Component[] {
  return (['dashboard', 'coordinator', 'characters'] as const)
    .filter(component => candidate.manifest.components[component] !== previous?.manifest.components[component]);
}
function acknowledged(candidate: Candidate, components: Component[], expected: Record<string, string>, observed: ActivationObservation): boolean {
  if (components.includes('coordinator') && (observed.coordinator?.artifactId !== candidate.manifest.id || observed.coordinator.hash !== candidate.manifest.components.coordinator)) return false;
  if (components.includes('dashboard') && observed.dashboardHash !== candidate.manifest.components.dashboard) return false;
  return Object.entries(expected).every(([name, hash]) => observed.characters[name] === hash);
}

/** Host owns service lifecycle, artifact routing and fresh acknowledgement reads. */
export function createDeploymentDriver(ports: ActivationPorts): DeploymentDriver {
  let attempted: Candidate | undefined;
  async function apply(candidate: Candidate, previous: Candidate | undefined, signal: AbortSignal): Promise<void> {
    const components = changed(candidate, previous);
    let expected: Record<string, string> = {};
    check(signal);
    if (components.includes('coordinator')) {
      await ports.stopCoordinator(signal);
      check(signal);
      await ports.startCoordinator(candidate.directory, signal);
    }
    check(signal);
    if (components.includes('dashboard')) await ports.activateDashboard(candidate.directory, signal);
    check(signal);
    if (components.includes('characters')||components.includes('coordinator')) expected = await ports.reloadCharacters(candidate.directory, signal);
    while (true) {
      check(signal);
      if (acknowledged(candidate, components, expected, await ports.observe(signal))) return;
      await delay(signal);
    }
  }
  return {
    async activate(candidate, previous, signal) {
      await ports.prepare?.(signal);
      attempted = candidate;
      await apply(candidate, previous, signal);
    },
    async restore(candidate, signal) {
      if (!candidate) throw new Error('No previous console artifact is available for restoration');
      await apply(candidate, attempted, signal);
      attempted = candidate;
    },
  };
}
