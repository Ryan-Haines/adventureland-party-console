import semanticRelease from 'semantic-release';
import { appendFileSync } from 'node:fs';
const result = await semanticRelease({ dryRun: true });
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${result ? result.nextRelease.version : ''}\n`);
