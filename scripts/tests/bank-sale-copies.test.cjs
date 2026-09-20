const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../dashboard/node_modules/typescript');
function load(name) {
 const file = `dashboard/features/party/${name}`;
 const code = ts.transpileModule(fs.readFileSync(fs.existsSync(file+'.ts') ? file+'.ts' : file+'.tsx','utf8'),
  {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context = vm.createContext({exports:{},require:path=>load(path.replace('./',''))});
 vm.runInContext(code,context);return context.exports;
}
const {bankSaleCopies}=load('bank-sale-copies');
const entry=(slot,item={name:'ring',level:1})=>({slot,item});
test('bulk bank NPC sale includes matching copies across panes and bankbois with full stack quantities',()=>{
 const selected=entry(0),bank={packs:{items0:[selected,null],items1:[entry(2,{name:'ring',level:1,q:4})]}};
 const result=bankSaleCopies(bank,[{name:'B',items:[entry(3)]}],selected);
 assert.deepEqual(Array.from(result,x=>[x.pack,x.entry.slot]),[['items0',0],['items1',2],['bankboi:B',3]]);
 assert.equal(result.reduce((sum,x)=>sum+(x.entry.item.q||1),0),6);
});
test('bulk sale excludes locked, different-level and differently modified copies',()=>{
 const selected=entry(0),items=[selected,entry(1,{name:'ring',level:1,l:'l'}),entry(2,{name:'ring',level:2}),
  entry(3,{name:'ring',level:1,stat_type:'int'}),entry(4,{name:'ring',level:1,p:'shiny'}),entry(5,{name:'coat',level:1})];
 assert.deepEqual(Array.from(bankSaleCopies({packs:{items0:items}},[],selected),x=>x.entry.slot),[0]);
 assert.equal(bankSaleCopies(null,[],selected).length,0);
});
