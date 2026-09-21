const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
const posix=p=>p.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase());

function run(overrides={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'party-docker-'));
 try {
  fs.writeFileSync(path.join(dir,'docker'),`#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$*" == 'compose version' ]]; then exit "\${COMPOSE_EXIT:-0}"; fi
if [[ "$*" == 'info' ]]; then exit "\${INFO_EXIT:-0}"; fi
case "$*" in
 *' build') exit "\${BUILD_EXIT:-0}" ;;
 *' up -d --force-recreate --wait --wait-timeout 300') exit "\${UP_EXIT:-0}" ;;
 *' exec -T '*) printf '%s\\n' "\${PUBLIC_URL:-}" ;;
 *' port party-console 3010') printf '%s\\n' "\${BINDING:-0.0.0.0:3010}" ;;
 *' ps'|*' logs '*) echo 'startup diagnostic' ;;
 *) echo "Unexpected Docker call: $*" >&2; exit 9 ;;
esac
`,{mode:0o755});
  fs.writeFileSync(path.join(dir,'ip'),'#!/usr/bin/env bash\nif [[ "\${NO_LAN:-0}" == 1 ]]; then exit 1; fi\necho "1.1.1.1 via 192.168.1.1 dev eth0 src 192.168.1.30"\n',{mode:0o755});
  const calls=path.join(dir,'calls');
  const result=spawnSync(bash,['-c','export PATH="$STUBS:$PATH"; bash "$HELPER"'],{
   cwd:dir,encoding:'utf8',env:{...process.env,STUBS:posix(dir),HELPER:posix(path.resolve('scripts/start-docker.sh')),CALLS:posix(calls),...overrides}});
  if(result.error)throw result.error;
  return {...result,calls:fs.existsSync(calls)?fs.readFileSync(calls,'utf8'):''};
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

test('Docker helper builds from the repository, waits, and prints the host LAN address',()=>{
 const r=run();assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/Party Console built! Starting/);
 assert.match(r.stdout,/Party Console ready! Open at http:\/\/192\.168\.1\.30:3010/);
 assert.match(r.calls,/--project-directory .* -f .*\/compose.yaml -f .*\/compose.dev.yaml build/);
 assert.match(r.calls,/up -d --force-recreate --wait --wait-timeout 300/);
 assert.doesNotMatch(r.calls,/\bdown\b|\bvolume\b/);
});
test('Docker helper respects public URLs, custom ports, and loopback bindings',()=>{
 for(const [env,url] of [
  [{PUBLIC_URL:'https://party.example'},'https://party.example'],
  [{BINDING:'0.0.0.0:8080'},'http://192.168.1.30:8080'],
  [{BINDING:'127.0.0.1:8080'},'http://127.0.0.1:8080'],
  [{BINDING:'[::1]:8080'},'http://[::1]:8080'],
  [{NO_LAN:'1'},'http://localhost:3010'],
 ]) {const r=run(env);assert.equal(r.status,0,r.stderr);assert.ok(r.stdout.includes('Open at '+url),r.stdout);}
});
test('Docker helper reports prerequisite, build, and startup failures without claiming readiness',()=>{
 for(const env of [{COMPOSE_EXIT:'1'},{INFO_EXIT:'1'},{BUILD_EXIT:'1'},{UP_EXIT:'1'}]) {
  const r=run(env);assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/Party Console ready!/);
  if(env.UP_EXIT) {assert.match(r.stderr,/startup diagnostic/);assert.match(r.calls,/logs --no-color --tail 50 party-console/);}
  else assert.doesNotMatch(r.calls,/up -d/);
 }
});
