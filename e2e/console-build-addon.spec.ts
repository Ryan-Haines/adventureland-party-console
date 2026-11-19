import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {buildCandidate} from '../tools/console-build/builder.ts';
import {ConsoleBuildStore} from '../tools/console-build/store.ts';
import {addonCandidate,CANDIDATE_FIXTURE,SECTION_CLASS,SECTION_FIXTURE} from './fixtures/addon-candidate.ts';

// AS25: the shipping builds
// find the add-on folders themselves. The image runs the same build tools as the candidate builder,
// so a candidate build covers both. A separate test, since a whole candidate build shares its setup
// with no other test.
test('AS25: a candidate build of a copy with an add-on folder type-checks and its coordinator bundle registers the add-on',async({},info)=>{
  test.setTimeout(30*60_000);
  // F-02467: the build moves nothing in the checkout store.
  const checkout=new ConsoleBuildStore(process.cwd());
  const records=()=>Promise.all(['references.json','completion-counts.json','summaries.json'].map(name=>readFile(path.join(checkout.directory,name),'utf8').catch(()=>null)));
  const before=await records();
  const result=await addonCandidate(process.cwd(),buildCandidate,checkout);
  expect(await records(),"the checkout store's references, counts and summaries").toEqual(before);
  info.annotations.push({type:'candidate build',description:`${result.id.slice(0,12)} in ${result.seconds.toFixed(1)} s`});
  expect(result.bundle).toContain(`name: "${CANDIDATE_FIXTURE}"`);
  expect(result.generated).toContain(`folder: "${CANDIDATE_FIXTURE}"`);
  // A folder with no dashboard.tsx builds, the section compiles against
  // the dashboard's one React, and its class is in the built CSS.
  expect(result.generated).toContain(`folder: "${SECTION_FIXTURE}"`);
  expect(result.sectionBuilt,'the section is in the client bundle').toBe(true);
  expect(result.reactCopies,'one React copy in the client chunks').toBe(1);
  expect(result.css).toContain(SECTION_CLASS.replace(/[[\]#]/g,c=>'\\'+c));
});
