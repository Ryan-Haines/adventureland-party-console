import { atomicJson } from '../build-store.ts';
// The release scripts' shared rules. bootstrap.mts and promote.mts export the public tree through
// PUBLIC_PATHS; bootstrap, payload and promote refuse or skip a private path; payload.mts and
// image-metadata.mts write release.json through writeRelease.
export const PUBLIC_PATHS = /^(README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|AGENTS\.md|Dockerfile|compose\.yaml|distribution\.json|release\.config\.mjs|package(-lock)?\.json|\.gitignore|\.gitattributes|\.dockerignore|\.github\/|characters\/|dashboard\/|docs\/|patches\/|runtime\/|scripts\/|tools\/|distribution\/)/;
export const privatePath = (file: string) => /(^|\/)(\.env[^/]*|config\.js|session\.[^/]*|secrets)(\/|$)/.test(file);
export interface ReleaseFields { version: string; repository: string; commit: string; files: Record<string, string> }
export const writeRelease = (file: string, fields: ReleaseFields) => atomicJson(file, { ...fields, protocol: 1, dataFormat: 1 });
