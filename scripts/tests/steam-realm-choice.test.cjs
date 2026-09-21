const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('../../.caracal/node_modules/jsdom');
const {createRealmChoice}=require('../../runtime/steam/realm-choice.ts');
const {installSteamBridge}=require('../../runtime/steam/bridge.ts');
test('realm modal survives polls, uses explicit dark colors, and sends one choice',async()=>{
 const dom=new JSDOM('');dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const calls=[];let resolve;const modal=createRealmChoice(dom.window.document,(...args)=>{calls.push(args);return new Promise(r=>resolve=r);});
 const op={id:'one',phase:'awaiting-realm-choice',realmChoice:{current:'SR_USIV',home:'SR_USII'}};
 modal.show(op);const dialog=dom.window.document.querySelector('dialog');modal.show(op);
 assert.equal(dialog,dom.window.document.querySelector('dialog'));assert.match(dialog.textContent,/currently on US IV.*home realm is US II/);
 assert.equal(dialog.style.backgroundColor,'rgb(21, 21, 21)');
 const buttons=dialog.querySelectorAll('button');assert.deepEqual([...buttons].map(b=>b.textContent),['Switch to US II realm','Stay on US IV realm','Cancel login']);
 buttons[1].click();buttons[1].click();assert.deepEqual(calls,[['one','stay']]);resolve();await new Promise(r=>setImmediate(r));
 assert.equal(dom.window.document.querySelector('dialog'),null);modal.dispose();dom.window.close();
});
test('unknown realms explain detection and offer enabled cancellation; Escape also cancels',async()=>{
 const dom=new JSDOM('');dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const calls=[];const modal=createRealmChoice(dom.window.document,async(...args)=>calls.push(args));
 modal.show({id:'one',phase:'awaiting-realm-choice',realmChoice:{current:null,home:'SR_USII'}});
 const buttons=[...dom.window.document.querySelectorAll('button')];
 assert.deepEqual(buttons.map(b=>b.textContent),['Cancel login']);assert.equal(buttons[0].disabled,false);
 assert.match(dom.window.document.querySelector('dialog').textContent,/Detecting which realm/);
 dom.window.document.querySelector('dialog').dispatchEvent(new dom.window.Event('cancel',{cancelable:true}));
 await Promise.resolve();assert.deepEqual(calls,[['one','cancel']]);modal.dispose();dom.window.close();
});
test('failed choices stay visible and Cancel login works without a known realm',async()=>{
 const dom=new JSDOM('');dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 const modal=createRealmChoice(dom.window.document,async()=>{throw new Error('Connection lost');});
 const op={id:'one',phase:'awaiting-realm-choice',realmChoice:{current:'SR_USIV',home:'SR_USII'}};
 modal.show(op);dom.window.document.querySelector('button').click();
 await new Promise(r=>setImmediate(r));
 assert.match(dom.window.document.querySelector('dialog').textContent,/Connection lost/);
 assert.ok([...dom.window.document.querySelectorAll('button')].every(b=>!b.disabled));
 modal.dispose();
 const calls=[];const cancel=createRealmChoice(dom.window.document,async(...args)=>calls.push(args));
 cancel.show({...op,realmChoice:{current:null,home:null}});
 dom.window.document.querySelector('button').click();await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls,[['one','cancel']]);assert.equal(dom.window.document.querySelector('dialog'),null);
 cancel.dispose();dom.window.close();
});

test('connected primary on wrong realm must navigate before any companion starts',async()=>{
 const dom=new JSDOM('',{url:'https://adventure.land'});let starts=0;
 const op={id:'one',phase:'navigate',destinationRealm:'SR_USII',multi:{primary:'P',desired:['P','M']}};
 const host={document:dom.window.document,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,
  character:{name:'P'},server_region:'US',server_identifier:'IV',socket:{connected:true},code_active:true,
  location:{href:''},get_active_characters:()=>({P:'self'}),start_character_runner:()=>{starts++;},
  setTimeout:()=>1,clearTimeout(){},fetch:async()=>Response.json({operation:op,primary:'P',realm:'SR_USIV',members:[]})};
 installSteamBridge(host);await new Promise(r=>setImmediate(r));
 assert.equal(host.location.href,'/character/P/in/US/II/');assert.equal(starts,0);host.__partySteamBridge.dispose();dom.window.close();
});
