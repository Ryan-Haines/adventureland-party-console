const {test}=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react');
const {create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
class PartyActionError extends Error {constructor(){super('confirmation');this.details={code:'auto_bank_confirmation_required'};}}
const {useBankWithdrawal}=load('bank-withdrawal.tsx',{'@/components/ui/*':new Proxy({},{get:(_target,key)=>key}),'./query-actions':{PartyActionError}});
function buttons(element){return !React.isValidElement(element)?[]:[...(element.type==='Button'?[element]:[]),...React.Children.toArray(element.props.children).flatMap(buttons)];}

test('withdrawal confirmation cancels without a second request, confirms original selection once, and retains errors',async()=>{
 const requests=[],notices=[];let view,finish;
 const post=async(_path,body)=>{requests.push(body);if(!body.removeAutoBankMark)throw new PartyActionError();return new Promise(resolve=>{finish=resolve;});};
 function Harness(){view=useBankWithdrawal(post,message=>notices.push(message));return null;}
 let tree;await act(async()=>{tree=create(React.createElement(Harness));});
 const entry={slot:4,item:{name:'vitring',level:0}};
 await act(async()=>view.withdraw('M','bankboi:B',entry,true));
 assert.equal(view.confirmation.props.open,true);assert.equal(requests.length,1);
 await act(async()=>buttons(view.confirmation)[0].props.onClick());
 assert.equal(view.confirmation.props.open,false);assert.equal(requests.length,1);
 await act(async()=>view.withdraw('M','items0',entry));
 entry.item.name='sword';
 const confirm=buttons(view.confirmation)[1];
 await act(async()=>{confirm.props.onClick();confirm.props.onClick();});
 assert.equal(requests.length,3);assert.equal(requests[2].removeAutoBankMark,true);
 assert.equal(requests[2].item.name,'vitring');assert.equal(requests[2].markAll,false);
 assert.ok(buttons(view.confirmation).every(button=>button.props.disabled));
 await act(async()=>{finish({ok:true});});
 assert.equal(view.confirmation.props.open,false);assert.deepEqual(notices,[]);
 await act(async()=>tree.unmount());
});

test('withdrawal errors have one owner and confirmed retries retain their selection',async()=>{
 const errors=[],requests=[];let view,fail=true;
 const post=async(_path,body)=>{requests.push(body);if(!body.removeAutoBankMark)throw new PartyActionError();if(fail)throw Error('Merchant unavailable');};
 function Harness(){view=useBankWithdrawal(post,message=>errors.push(message));return null;}
 let tree;await act(async()=>{tree=create(React.createElement(Harness));});
 await act(async()=>view.withdraw(null,'items0',{slot:1,item:{name:'ring'}}));
 assert.deepEqual(errors,['No merchant is configured']);errors.length=0;
 await act(async()=>view.withdraw('M','items0',{slot:1,item:{name:'ring'}}));
 await act(async()=>buttons(view.confirmation)[1].props.onClick());
 assert.equal(view.confirmation.props.open,true);assert.deepEqual(errors,[]);
 function alerts(element){return !React.isValidElement(element)?[]:[...(element.props.role==='alert'?[element.props.children]:[]),...React.Children.toArray(element.props.children).flatMap(alerts)];}
 assert.deepEqual(alerts(view.confirmation),['Merchant unavailable']);
 fail=false;await act(async()=>buttons(view.confirmation)[1].props.onClick());
 assert.equal(view.confirmation.props.open,false);assert.deepEqual(alerts(view.confirmation),[]);
 assert.deepEqual(requests[1],requests[2]);assert.deepEqual(errors,[]);
 await act(async()=>tree.unmount());
});
