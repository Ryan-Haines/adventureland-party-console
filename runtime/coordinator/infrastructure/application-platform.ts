/** Dependencies resolved by the installed caracAL launcher, independent of bundle location. */
export interface CoordinatorApplicationPlatform {
  require: NodeRequire;
  directory: string;
  loadFetch(): Promise<typeof import("node-fetch").default>;
}
