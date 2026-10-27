/* Real dashboard handlers with a deterministic wallet adapter, no signatures,
 * network funds or extension claims. The adapter itself has separate tests. */
import assert from 'node:assert/strict';
import {boot,flush} from '../../tests/frontend-harness.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
let loanCalls=0;
const loan={id:'1',lender:'0x'+'11'.repeat(32),borrower:'0x'+'22'.repeat(32),principalRaw:'100000000',collateralWei:'100000000000000000000',interestRaw:'657535',expiresAt:'1793615102',acceptedAt:'1793011491',dueAt:'1795603491',deadline:'1795862691',aprBps:800,termDays:30,graceDays:3,status:'repaid'};
const loanData={available:true,offers:[loan],coverage:{returnedOffers:1,totalOffers:'21',complete:false},observedAt:'2026-10-27T12:00:00+00:00',tokenAddress:'0x'+'33'.repeat(32),lendingAddress:'0x'+'44'.repeat(32)};
const app=await boot('dist',{route:'#defi',fetchHandler:async request=>{
  if(request==='/api/test-defi'){loanCalls++;return {ok:true,json:async()=>clone(loanData)};}
}});
const root=()=>app.document.querySelector('#page-content');
const click=async action=>{const el=root().querySelector(`[data-defi-live-action="${action}"]`);assert.ok(el,action);await el.click();};
const view=async name=>root().querySelector(`[data-defi-live-view="${name}"]`).click();
const state=()=>clone(app.context.NodusDefi.getState());
assert.equal(loanCalls,0,'no loan RPC until explicit read');
assert.equal(state().wallet.connected,false);
await click('connect');
assert.equal(state().failed,true);
assert.ok(root().querySelector('#defi-live-feedback').focused,'missing-wallet error is focused next to action');

let walletState={connected:false,address:null,selectedNetwork:'nile',network:null,chainId:null,balances:{trxRaw:null,tokenRaw:null},token:null,busy:false,error:null,pending:[]};
let changed=null,submitCount=0,prepared=null;
app.context.NodusDefi.unmount();
// A fresh script instance lets the test supply a wallet before its lazy create.
app.context.NodusDefiTron={create({onChange}){
  changed=()=>onChange(clone(walletState));
  return {
    getState:()=>clone(walletState),
    async connect(){walletState={...walletState,connected:true,address:'TRKLH73z6t3c5DGeRxRGqY8XE8vekLrvfg',network:'nile',chainId:'0xcd8690dc',balances:{trxRaw:'1000000000',tokenRaw:'1000000000'},token:{address:'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',symbol:'test USDT',decimals:6}};changed();},
    async prepareTransfer(to,amount){prepared={id:'ab'.repeat(32),txID:'ab'.repeat(32),network:'nile',chainId:'0xcd8690dc',from:walletState.address,to,amount,amountRaw:'1250001',tokenAddress:walletState.token.address,symbol:'test USDT',feeLimitSun:'100000000'};return clone(prepared);},
    async submitTransfer(){submitCount++;walletState.error='Broadcast status is uncertain. Check this transaction before sending again.';walletState.pending=[{...prepared,status:'unknown'}];changed();return {...prepared,status:'unknown'};},
    disconnect(){walletState={...walletState,connected:false,address:null,network:null,chainId:null};changed();},
    async refresh(){changed();},async reconcile(){changed();},
    async setNetwork(key){walletState={...walletState,selectedNetwork:key,connected:false,address:null,network:null,chainId:null,token:null,balances:{trxRaw:null,tokenRaw:null}};changed();},
  };
}};
// Reload only the view script. Existing model/assets remain the shipped ones.
import fs from 'node:fs';
app.run(fs.readFileSync('dist/test-defi/defi.js','utf8'));
app.context.NodusDefi.mount(root());
await click('connect');
assert.equal(state().wallet.connected,true);
assert.match(root().innerHTML,/1000/,'wallet balances use returned exact raw amounts');
root().querySelector('#defi-live-to').value='T'+'A'.repeat(33);
root().querySelector('#defi-live-amount').value='1.250001';
await root().querySelector('#defi-live-transfer').fire('submit');await flush();
assert.equal(submitCount,0,'reviewing never signs or broadcasts');
assert.equal(state().review.amountRaw,'1250001');
assert.ok(root().querySelector('#defi-live-review').focused,'review is focused at the action');
assert.match(root().innerHTML,/Energiamaksun yläraja/);
await click('confirm-transfer');
assert.equal(submitCount,1);
assert.equal(state().failed,true,'uncertain broadcast has explicit feedback');
assert.doesNotMatch(root().innerHTML,/Siirto lähetetty\./,'uncertain receipt is not success');
assert.match(root().innerHTML,/Tila epävarma/);

walletState.error=null;changed();
root().querySelector('#defi-live-to').value='T'+'B'.repeat(33);
root().querySelector('#defi-live-amount').value='1.250001';
await root().querySelector('#defi-live-transfer').fire('submit');await flush();
walletState={...walletState,connected:false,address:null,network:null};changed();
assert.equal(state().review,null,'account change removes stale confirmation');
assert.equal(root().querySelector('[data-defi-live-action="confirm-transfer"]'),null);

await view('loans');
assert.equal(loanCalls,0);
assert.doesNotMatch(root().querySelector('#defi-live-feedback').innerHTML,/Broadcast/,'wallet errors stay in wallet view');
await click('load-loans');
assert.equal(loanCalls,1);
assert.match(root().innerHTML,/100\.657535/,'contract principal and interest remain exact');
assert.match(root().innerHTML,/Maksettu/);
assert.match(root().innerHTML,/100 NODUS/);
assert.ok(root().querySelector('[data-defi-live-action="unavailable"]').disabled,'no fabricated browser Nodus signing');
assert.match(root().innerHTML,/21/,'partial offer coverage is visible');
app.context.NodusI18n.setLanguage('en');
assert.match(root().innerHTML,/Read-only contract view/);
assert.match(root().innerHTML,/Repaid/);
await view('wallet');
assert.equal(state().form.amount,'1.250001','view and language changes preserve form values');
await view('practice');
await root().querySelector('[data-defi-action="examples"]').click();
assert.equal(app.context.NodusDefiPractice.getState().states.length,2);
assert.equal(state().loanData.offers.length,1,'practice offers never enter the actual loan book');
assert.equal(loanCalls,1,'practice never queries a loan or wallet');
console.log('DeFi browser UI: connection errors, review, uncertainty, changed account, loan read source and isolated practice passed.');
