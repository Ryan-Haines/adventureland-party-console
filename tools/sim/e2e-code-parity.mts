import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {GameManifest} from '../game/manifest.ts';
type Attachment = { name: string; path: string };
type Outcome = { title: string; attachments: Attachment[] };
function verifyExecutedCode(archive:string,test:Outcome,report:GameManifest){
  const file=test.attachments.find(attachment=>attachment.name==='native-initial-code-identities');
  if(!file)throw Error(`Missing executed CODE identities: ${test.title}`);
  const identities=JSON.parse(readFileSync(path.join(archive,file.path.replaceAll('\\','/')),'utf8')) as {
    generation:string;names:string[];expected:Array<{name:string;ctype:keyof GameManifest['classes'];sha256:string}>;
    observations:Array<{observed:unknown}>;
  };
  if(identities.generation!==report.generation||identities.names.length<3||new Set(identities.names).size!==identities.names.length||
    JSON.stringify(identities.names)!==JSON.stringify(identities.expected.map(client=>client.name))||
    identities.expected.some(client=>report.classes[client.ctype]?.sha256!==client.sha256)||
    JSON.stringify(identities.observations.at(-1)?.observed)!==JSON.stringify(identities.expected))
    throw Error(`Executed CODE differs from staged manifest: ${test.title}`);
}
export function verifyCodeParity(directory: string, gameplay: string[]) {
  const generations: Record<string, string[]> = {};
  for (const backend of ["native", "accelerated"]) {
    const archive = path.join(directory, backend),
      manifest = JSON.parse(
        readFileSync(path.join(archive, ".build/e2e-report/manifest.json"), "utf8"),
      ) as { tests: Outcome[] };
    generations[backend] = manifest.tests
      .filter((test) => gameplay.includes(test.title.split(" > ").at(-1)!))
      .map((test) => {
        const name = "live-build-manifest",
          file = test.attachments.find((attachment) => attachment.name === name);
        if (!file) throw Error(`Missing ${backend} CODE generation: ${test.title}`);
        const report = JSON.parse(
          readFileSync(path.join(archive, file.path.replaceAll("\\", "/")), "utf8"),
        );
        const generation = report.generation;
        if (!/^[a-f0-9]{64}$/.test(generation)) throw Error("Invalid CODE generation");
        verifyExecutedCode(archive,test,report);
        return generation;
      });
    if (generations[backend].length !== gameplay.length)
      throw Error("Incomplete CODE parity evidence");
  }
  if (new Set(Object.values(generations).flat()).size !== 1)
    throw Error("Benchmark ran different character CODE generations");
  const result = { pass: true, scenarios:gameplay.length, generation: generations.native[0], generations };
  writeFileSync(path.join(directory, "code-parity.json"), JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory=path.resolve(process.argv[2]);
  const native=JSON.parse(readFileSync(path.join(directory,'native/.build/e2e-report/manifest.json'),'utf8')) as {tests:Outcome[]};
  const gameplay=native.tests.filter(test=>test.title.split(' > ')[1]==='live').map(test=>test.title.split(' > ').at(-1)!);
  if(!gameplay.length)throw Error('Archive has no gameplay scenarios');
  console.log(JSON.stringify(verifyCodeParity(directory, gameplay)));
}
