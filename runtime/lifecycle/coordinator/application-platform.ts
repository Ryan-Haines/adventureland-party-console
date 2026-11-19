/** Dependencies resolved by the installed caracAL launcher, independent of bundle location. */
export interface CoordinatorApplicationPlatform {
  require: NodeRequire;
  directory: string;
  /** Immutable executable directory; mutable installed data keeps directory. */
  codeDirectory?: string;
  /** Built planner executable when a disposable host isolates its CODE directory. */
  plannerWorkerFile?: string;
  loadFetch(): Promise<typeof import("node-fetch").default>;
}
