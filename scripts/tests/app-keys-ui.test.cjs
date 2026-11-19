const {test}=require('node:test'),assert=require('node:assert/strict'),{load,queryRoot}=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const tags=new Proxy({},{get:(_,key)=>String(key)});
const {AppKeysSettings}=load('app-keys-settings.tsx',{'@/components/ui/*':tags});
// Each read answers after the first render; `settle` lets React Query deliver it.
const settle=()=>act(()=>new Promise(resolve=>setTimeout(resolve,0)));
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');

// The Interface settings "Apps" screen (the status owner's table K) over a planted console: the
// screen issues a key and shows it once, saves a setting lock through the settings owner's
// settings route and revokes the key. e2e/live-status-hooks.spec.ts drives the same screen against
// the coordinator.
test('the Apps screen shows a key once, locks a setting through the settings route and revokes', async () => {
  // The config read runs only on a shown page (query-cache.tsx useVisible).
  const old=global.fetch,oldDocument=global.document,posts=[],key='ab'.repeat(32);
  global.document={hidden:false,addEventListener(){},removeEventListener(){}};
  const apps=[],settings=[{field:'appLocks',label:'Settings locked against apps',value:[]},{field:'anniversaryAutoChat',label:'Anniversary auto chat',value:false}];
  const answers={'/apps':()=>({apps,scopes:['read','command','settings','spend']}),'/settings':()=>({settingsAt:1,settings}),'/state':()=>({})};
  global.fetch=async(url,options={})=>{
    const route=String(url).replace(/^\/party-api/,''),path=route.split('?')[0];
    let result;
    if(options.method==='POST'){
      const body=JSON.parse(options.body);posts.push([path,body]);
      if(path==='/apps'){apps.push({name:body.name,scopes:body.scopes,ownCommands:body.ownCommands,lastUsedAt:null,revokedAt:null});result={key};}
      else if(path.endsWith('/revoke')){apps.find(app=>`/apps/${app.name}/revoke`===path).revokedAt=2;result={ok:true};}
      else if(path==='/settings'){for(const change of body.changes)settings.find(entry=>entry.field===change.field).value=change.value;result={ok:true};}
    } else result=(answers[path]??answers['/state'])();
    // query-cache's read takes json(); query-actions' send takes text().
    return {ok:true,status:200,redirected:false,headers:new Headers(),json:async()=>result,text:async()=>JSON.stringify(result)};
  };
  // The client's cache keeps garbage-collection timers for every read; clear() drops them so the
  // process exits.
  const {client,wrap}=queryRoot();let view;
  const input=label=>view.root.find(n=>n.type==='label'&&text(n).trim()===label).findByType('input');
  const button=label=>view.root.findAllByType('Button').find(n=>text(n)===label);
  try{
    await act(async()=>{view=create(wrap(React.createElement(AppKeysSettings)));});await settle();
    await act(async()=>view.root.findByProps({'aria-label':'App name'}).props.onChange({target:{value:'tracker'}}));
    await act(async()=>input('Change settings').props.onChange({target:{checked:true}}));
    await act(async()=>button('Issue key').props.onClick());await settle();
    assert.deepEqual(posts.at(-1),['/apps',{name:'tracker',scopes:['read','settings'],ownCommands:false}]);
    const shown=view.root.findByProps({'data-testid':'issued-app-key'});
    assert.match(text(shown),/Key for tracker, shown only now/);assert.equal(text(shown.findByType('code')),key);
    const row=()=>view.root.findAll(n=>n.props['data-testid']==='app-key'&&text(n).includes('tracker'));
    assert.equal(row().length,1);assert.ok(!text(row()[0]).includes(key),'the app row never shows the key');
    assert.equal(view.root.findByType('fieldset').props.disabled,false,'the locks open once config and the settings page arrived');
    await act(async()=>input('Anniversary auto chat').props.onChange({target:{checked:true}}));await settle();
    assert.deepEqual(posts.at(-1),['/settings',{changes:[{field:'appLocks',value:['anniversaryAutoChat']}],basis:1}]);
    assert.equal(input('Anniversary auto chat').props.checked,true);
    // A remount is the next visit to the screen: the key shows only at issue.
    await act(async()=>view.unmount());await act(async()=>{view=create(wrap(React.createElement(AppKeysSettings)));});await settle();
    assert.equal(view.root.findAll(n=>n.props['data-testid']==='issued-app-key').length,0);
    await act(async()=>row()[0].findAllByType('Button').find(n=>text(n)==='Revoke').props.onClick());await settle();
    assert.deepEqual(posts.at(-1),['/apps/tracker/revoke',{}]);assert.equal(row().length,0);
  }finally{if(view)await act(async()=>view.unmount());client.clear();global.fetch=old;global.document=oldDocument;}
});
