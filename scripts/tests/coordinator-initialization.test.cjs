const test=require('node:test'),assert=require('node:assert/strict');
const {initializeCoordinatorState}=require('../../runtime/coordinator/initialization.ts');
const {stateKeys}=require('../../runtime/coordinator/persistence/snapshots.ts');
test('startup assembles persisted roster, bank and navigation state without writing or losing identity',()=>{
 const calls=[],settings={merchantCharacter:'M',navigationIntents:{P:{revision:8,cancelled:true}},huntEventTrips:{P:[]}};
 const saved={
  [stateKeys.settings]:JSON.stringify(settings),[stateKeys.roster]:JSON.stringify({headlessSlots:['P',null,'M'],nativeOwner:'W'}),
  [stateKeys.bank]:JSON.stringify({bankbois:{B:{name:'B',items:[]}},withdrawals:{M:[]}}),
 };
 const result=initializeCoordinatorState({get:key=>{calls.push(key);return saved[key];},set:()=>assert.fail('initialization wrote storage')},
  {Unexpected:{enabled:true}},'SR_EUI',{now:()=>{calls.push('clock');return 100;},loadBankVaultDefinitions:()=>[{pack:'items0'}],warn:()=>assert.fail('valid snapshots warned')});
 assert.deepEqual(calls.slice(0,6),Object.values(stateKeys));assert.equal(calls[6],'clock');
 assert.deepEqual(result.party.headlessSlots,['P',null,'M',null]);assert.equal(result.party.nativeOwner,'W');
 assert.deepEqual(result.party.steamMembers,['W']);assert.equal(result.party.activeRealm,'SR_EUI');
 assert.deepEqual(result.party.bankbois,{B:{name:'B',items:[]}});
 assert.deepEqual(result.persistedSettings.navigationIntents,settings.navigationIntents);
 assert.equal(result.party.huntEventTrips,result.persistedSettings.huntEventTrips);
});
test('portable merchant defaults preserve saved selection and explicit absence without writing storage', () => {
  for (const [savedMerchant, merchantDefault, expected] of [
    [undefined, 'AccountMerchant', 'AccountMerchant'],
    ['SavedMerchant', 'AccountMerchant', 'SavedMerchant'],
    [undefined, null, null], ['SavedMerchant', null, 'SavedMerchant'],
    ['', null, null], [undefined, undefined, 'GoldMajesty'],
  ]) {
    const storage = {get: key => key === stateKeys.settings ? JSON.stringify({merchantCharacter: savedMerchant}) : undefined,
      set: () => assert.fail('default selection must not rewrite saved settings')};
    const result = initializeCoordinatorState(storage, {}, 'SR_USII', {
      merchantDefault, now: () => 100, loadBankVaultDefinitions: () => [], warn: () => assert.fail('valid defaults warned'),
    });
    assert.equal(result.party.merchantCharacter, expected);
    assert.equal(result.persistedSettings.merchantCharacter, savedMerchant);
  }
});

test('malformed roster JSON falls back independently while valid settings survive',()=>{
 const warnings=[];
 const result=initializeCoordinatorState({get:key=>key===stateKeys.roster?'{broken':key===stateKeys.settings?'{"merchantCharacter":"M"}':undefined,set:()=>{}},
  {P:{enabled:true},Off:{enabled:false},M:{enabled:true}},'SR_USII',{
   now:()=>100,loadBankVaultDefinitions:()=>[],warn:(details,message)=>warnings.push({details,message}),
  });
 assert.deepEqual(result.party.headlessSlots,['P','M',null,null]);assert.equal(result.party.merchantCharacter,'M');
 assert.equal(warnings.length,1);assert.equal(warnings[0].message,'Ignoring invalid persisted Party Console roster state');
 assert.ok(warnings[0].details.error instanceof SyntaxError);
});
