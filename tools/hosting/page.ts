export const setupPage = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Party Console setup</title>
<style>body{font:17px system-ui;background:#101318;color:#f4f4f5;max-width:760px;margin:40px auto;padding:20px}button,input,select,textarea{font:inherit;background:#232933;color:#fff;border:1px solid #8693a6;border-radius:6px;padding:10px;margin:8px 0}button{cursor:pointer}button:hover{background:#38465a}input,textarea{box-sizing:border-box;width:100%}textarea{height:130px}a{color:#93c5fd}code{overflow-wrap:anywhere}section{border:1px solid #596579;padding:18px;margin:20px 0}#error{color:#fca5a5;white-space:pre-wrap}label{display:block}</style></head><body>
<style>.session-field{display:flex;gap:8px;align-items:center}.session-field input{flex:1;min-width:0}.session-field button{display:flex;align-items:center;justify-content:center;flex:none;background:#232933;color:#fff;border:1px solid #8693a6;width:46px;height:46px}.session-field button:hover{background:#38465a;color:#fff;border-color:#b7c7dd}.session-field button:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}.session-field svg{width:22px;height:22px}</style>
<h1>Party Console</h1><p>Your bots run here. Steam and browsers connect over your home network.</p><p id="error" role="status"></p><p id="success" role="status" style="color:#86efac" hidden></p>
<section id="pair" hidden><h2>Pair this browser</h2><p>Open an invitation from an authorized browser or the server startup output.</p><button id="pairButton">Pair browser</button></section>
<main id="settings" hidden><section id="account"><h2>Connect your game account</h2><p>You only need to connect your account once. In the Adventure Land Steam client, log in to a character, open CODE, paste this line, and click Engage:</p><code>show_json(parent.user_id + "-" + parent.user_auth)</code><p>Copy the displayed session and paste it below.</p>
<label for="session">Game session</label><div class="session-field"><input id="session" type="password" autocomplete="off" autocapitalize="none" spellcheck="false"><button id="toggleSession" type="button" aria-label="Show game session" title="Show game session" aria-controls="session" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path id="sessionSlash" d="m3 3 18 18" style="display:none"/></svg></button></div><label>Realm<select id="realm"><option>SR_USII</option><option>SR_USI</option><option>SR_USIII</option><option>SR_EUI</option><option>SR_EUII</option><option>SR_ASIAI</option></select></label><button id="connect">Connect account</button><p>Characters start disabled. Select offline characters in the dashboard to run them headless; leave Steam characters in Steam.</p></section>
<div id="paths" hidden><section><h2>Control characters in Steam or a browser</h2><p>To let Party Console control your character’s actions in Steam or your browser, paste this code into your client’s CODE window and click Engage.</p><p>Your console address: <strong id="address"></strong>. Detected automatically.</p><button id="loader">Generate client loader</button><textarea id="code" readonly aria-label="Client loader code"></textarea><button id="copy" disabled>Copy code</button><p id="loaderHelp"></p><p id="linkStatus" role="status"></p><button id="revoke">Revoke all Steam connections</button></section>
<section><h2>Run characters fully headless</h2><p>Log out your characters from any other game windows, then continue to the dashboard to run them headless.</p><a id="continue" href="/">Continue to dashboard</a><style>#continue{display:inline-block;background:#232933;color:#fff;border:1px solid #8693a6;border-radius:6px;padding:10px;text-decoration:none}#continue:hover{background:#38465a;color:#fff;border-color:#b7c7dd}#continue:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}button:disabled{opacity:.6;cursor:default}</style></section></div>
<section><h2>Connection settings</h2><button id="invite" hidden>Pair another browser</button><p id="invitation"></p></section></main>
<script>
const el=id=>document.getElementById(id);let serverAddress=location.origin;el('address').textContent=serverAddress;
function sessionVisible(visible){el('session').type=visible?'text':'password';const label=visible?'Hide game session':'Show game session';el('toggleSession').setAttribute('aria-label',label);el('toggleSession').setAttribute('aria-pressed',String(visible));el('toggleSession').title=label;el('sessionSlash').style.display=visible?'':'none'}
el('toggleSession').onclick=()=>sessionVisible(el('session').type==='password');
let returnTimer,pollTimer,linkGeneration=0;
function stopLinking(){linkGeneration++;clearTimeout(pollTimer);clearInterval(returnTimer)}
function returnToDashboard(){
 clearInterval(returnTimer);let seconds=5;el('error').textContent='';el('success').hidden=false;
 const update=()=>{el('success').textContent='Client connected. Returning to dashboard in '+seconds+'…'};
 update();returnTimer=setInterval(()=>{seconds--;if(seconds===0){clearInterval(returnTimer);location.assign('/');return}update()},1000);
}
addEventListener('pagehide',stopLinking);
el('continue').onclick=stopLinking;
async function watchConnection(generation){
 if(generation!==linkGeneration)return;
 try{
  const r=await fetch('/party-api/steam/connection',{cache:'no-store'});if(!r.ok)throw Error('Connection check unavailable');const s=await r.json();
  if(generation!==linkGeneration)return;
  if(s.connected===true){el('linkStatus').textContent='Client connected.';returnToDashboard();return}
  el('linkStatus').textContent='Waiting for your client to connect…';
 }catch{if(generation!==linkGeneration)return;el('linkStatus').textContent='Waiting for the console. Connection check will retry…'}
 pollTimer=setTimeout(()=>watchConnection(generation),2000);
}
async function generateLoader(){
 stopLinking();
 const r=await call('steam',{origin:serverAddress});el('code').value=r.code;el('copy').disabled=false;
 el('linkStatus').textContent='Waiting for your client to connect…';void watchConnection(linkGeneration);
}
async function call(path,body){const r=await fetch('/setup/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
const action=(id,fn)=>el(id).onclick=async()=>{el(id).disabled=true;el('error').textContent='';try{await fn()}catch(e){el('error').textContent=e.message}finally{el(id).disabled=false}};
async function refresh(){const s=await call('state');serverAddress=s.serverAddress||location.origin;el('address').textContent=serverAddress;el('pair').hidden=true;el('settings').hidden=false;el('account').hidden=!s.canConfigureAccount||s.configured;el('paths').hidden=!s.configured;el('invite').hidden=!s.requirePairing;el('loaderHelp').textContent=s.requirePairing?'Keep this code private: it grants control of this server.':'Anyone who can reach this server can connect while pairing is off.';el('error').textContent=''}
action('pairButton',async()=>{await call('pair',{token:location.hash.slice(1)});history.replaceState(null,'','/setup');await refresh()});
action('connect',async()=>{await call('session',{session:el('session').value,realm:el('realm').value});el('session').value='';sessionVisible(false);await refresh();el('success').hidden=false;el('success').textContent='Account connected. Choose how to run your characters below.';await generateLoader()});
action('loader',async()=>{el('success').hidden=true;await generateLoader()});
action('copy',async()=>{try{await navigator.clipboard.writeText(el('code').value);el('linkStatus').textContent='Copied. Paste into your client’s CODE window and click Engage.'}catch{el('code').focus();el('code').select();el('linkStatus').textContent='Code selected. Copy it and paste into your client’s CODE window.'}});
action('revoke',async()=>{if(confirm('Revoke every private Steam token? Direct tokenless loaders are unaffected. Running headless characters continue.')){await call('revoke',{});stopLinking();el('success').hidden=true;el('code').value='';el('copy').disabled=true;el('linkStatus').textContent='Steam credentials revoked. Generate a new loader to reconnect.'}});
action('invite',async()=>{const r=await call('invite',{});el('invitation').textContent=location.origin+'/setup#'+r.token});refresh().catch(e=>{el('pair').hidden=false;el('error').textContent=e.message});
</script></body></html>`;
