const test=require('node:test'),assert=require('node:assert/strict');
const {createAnniversarySupplies,anniversaryTradeIdentity}=require('../../runtime/coordinator/anniversary/supplies.ts');
const item=(name,q)=>({item:{name,q}});

test('anniversary supply totals prefer BankBoi snapshots over duplicate live inventories and read replacement state',()=>{
 const state={statuses:{M:{name:'M',items:[item('slice_citrus',2),item('leather',9)]},B:{name:'B',items:[item('slice_citrus',99)]}},
  bankSnapshot:{packs:{items0:[item('slice_citrus',3)]}},bankbois:{B:{name:'B',items:[item('slice_citrus',4)]}},anniversary:{}};
 const service=createAnniversarySupplies(state);
 assert.deepEqual(service.counts(),{slice_strawberry:0,slice_citrus:9,slice_honey:0,slice_mint:0,slice_blueberry:0,slice_nightberry:0});
 state.statuses={F:{name:'F',items:[item('slice_mint',1)]}};state.bankSnapshot=null;state.bankbois=null;
 assert.equal(service.counts().slice_citrus,0);assert.equal(service.counts().slice_mint,1);
});

test('reciprocal trade identities preserve account coercion and character fallback rules',()=>{
 for(const [owner,sender,expected] of [[0,'Mage','account:0'],[' 123 ','Mage','account:123'],[null,'MaGe','character:mage'],
  [undefined,' Mage ','character: mage '],['  ',null,'character:'],[false,'Mage','account:false'],[{},'Mage','account:[object Object]']])
  assert.equal(anniversaryTradeIdentity(owner,sender),expected);
});

test('reciprocal trade lookup reads current records, honors stored identity and releases only returned trades',()=>{
 const state={statuses:{},bankSnapshot:null,anniversary:{reciprocal:{empty:null,pending:{owner:123,sender:'Mage',state:'pending'}}}};
 const service=createAnniversarySupplies(state);
 assert.equal(service.alreadyTraded('account:123'),true);assert.equal(service.alreadyTraded('character:mage'),false);
 state.anniversary={reciprocal:{done:{owner:123,state:'returned'},failed:{sender:'Priest',state:'failed'},explicit:{identity:'saved',owner:456}}};
 assert.equal(service.alreadyTraded('account:123'),false);assert.equal(service.alreadyTraded('character:priest'),true);
 assert.equal(service.alreadyTraded('saved'),true);assert.equal(service.alreadyTraded('account:456'),false);
});
