import { readFileSync } from 'node:fs';
const { repository } = JSON.parse(readFileSync(new URL('./distribution.json', import.meta.url)));
export default {
  branches: ['main'], repositoryUrl: `https://github.com/${repository}.git`, tagFormat: 'v${version}',
  plugins: [
    '@semantic-release/commit-analyzer', '@semantic-release/release-notes-generator',
    './tools/release/verify-assets.cjs',
    ['@semantic-release/github', { successComment: false, failComment: false, releasedLabels: false,
      assets: ['.build/release/*.zip', '.build/release/release-manifest.json', { path: 'distribution/compose.release.yaml', name: 'compose.yaml' }] }],
  ],
};
