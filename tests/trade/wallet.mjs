import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const vendor=fs.readFileSync(new URL('../../dist/vendor/ethers-6.15.0.umd.min.js',import.meta.url),'utf8');
assert.equal(createHash('sha256').update(vendor).digest('hex'),'fcfd9597005606eabed524ed9f97df69dbc5cac461119a9bb8a4c6b280cfa3f1','reviewed ethers bundle');
const a='0x'+'11'.repeat(20),token='0x'+'22'.repeat(20),swap='0x'+'33'.repeat(20),recipient='0x'+'44'.repeat(20);
function boot(){
 const calls=[],listeners={},context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,console,setTimeout,clearTimeout,Date,CustomEvent,dispatchEvent(){}};context.window=context;vm.createContext(context);
 for(const file of ['vendor/ethers-6.15.0.umd.min.js','trade-contracts.js','trade-wallet.js'])vm.runInContext(fs.readFileSync(new URL('../../dist/'+file,import.meta.url),'utf8'),context,{filename:file});
 const E=context.ethers,iface=new E.Interface(['function token() view returns(address)','function decimals() view returns(uint8)']);
 let chain='0x61',account=a,codeOverride=null,sendError=null,estimateHook=null,broadcasts=0;
 context.ethereum={on(event,fn){listeners[event]=fn;},removeListener(event){delete listeners[event];},async request({method,params=[]}){
  calls.push({method,params});if(method==='eth_chainId')return chain;if(method==='eth_requestAccounts'||method==='eth_accounts')return [account];
  if(method==='eth_getCode')return codeOverride??context.NodusTradeContracts.contracts[params[0]===token?'mockUsdt':'bsc'].runtime;
  if(method==='eth_call')return params[0].to===token?iface.encodeFunctionResult('decimals',[18]):iface.encodeFunctionResult('token',[token]);
  if(method==='eth_estimateGas'){if(estimateHook)estimateHook();return '0x186a0';}
  if(method==='eth_sendTransaction'){broadcasts++;if(sendError)throw sendError;return '0x'+'ab'.repeat(32);}
  throw Error('Unexpected '+method);
 }};
 return {context,calls,listeners,W:context.NodusTradeWallet,E,setChain(x){chain=x;},setAccount(x){account=x;},code(x){codeOverride=x;},sendError(x){sendError=x;},hook(x){estimateHook=x;},broadcasts:()=>broadcasts};
}
const b=boot();assert.equal(b.calls.length,0,'no wallet RPC on script load');await b.W.connect();assert.equal(b.W.getState().address,a);
let request=await b.W.prepareDeployment('mockUsdt');assert.equal(request.notSent,true);assert.equal(request.chainId,97);assert.equal(b.broadcasts(),0,'preparation is not broadcast');
let result=await b.W.submit(request);assert.equal(result.status,'submitted');assert.equal(result.hash,'0x'+'ab'.repeat(32));assert.equal(b.broadcasts(),1);assert.equal(b.calls.at(-1).params[0].value,'0x0');assert.equal(b.calls.at(-1).params[0].chainId,'0x61');await assert.rejects(b.W.submit(request),e=>e.code==='request_used');
request=await b.W.prepareDeployment('bsc',{token});assert(request.data.endsWith(token.slice(2)));await b.W.submit(request);assert.equal(b.broadcasts(),2);
request=await b.W.prepareFaucet(token);await b.W.submit(request);assert.equal(b.broadcasts(),3);
for(const mutation of [{chainId:56},{chain:'nodus'},{from:recipient},{valueWei:'1'},{notSent:false},{expiresAt:0},{action:'unknown'},{data:'0xdeadbeef'}])await assert.rejects(b.W.submit({...request,...mutation}));assert.equal(b.broadcasts(),3,'invalid requests never sent');
b.code('0x00');await assert.rejects(b.W.prepareFaucet(token),e=>e.code==='wrong_token_code');b.code(null);
const iface=new b.E.Interface(b.context.NodusTradeContracts.contracts.bsc.abi),approve=new b.E.Interface(['function approve(address,uint256)']);
const base={schema:'nodus-trade/wallet-request-v1',chain:'bsc',chainId:97,from:a,valueWei:'0',preparedAt:Math.floor(Date.now()/1000),expiresAt:Math.floor(Date.now()/1000)+30,notSent:true,assetToken:token};
await b.W.submit({...base,action:'approve',to:token,data:approve.encodeFunctionData('approve',[swap,10n**18n])});
await b.W.submit({...base,action:'open',to:swap,data:iface.encodeFunctionData('open',['0x'+'01'.repeat(32),recipient,'0x'+'02'.repeat(32),10n**18n,Math.floor(Date.now()/1000)+7200])});
const secret='0x'+'03'.repeat(32),estimatesBeforeClaim=b.calls.filter(x=>x.method==='eth_estimateGas').length;await b.W.submit({...base,action:'claim',to:swap,data:iface.encodeFunctionData('claim',[a,'0x'+'01'.repeat(32),secret])});
assert.equal(b.calls.filter(x=>x.method==='eth_estimateGas').length,estimatesBeforeClaim,'no extra secret-bearing estimate before wallet');
assert(!JSON.stringify(b.W.getState()).includes(secret),'signer state never retains the preimage');
b.setChain('0x38');const count=b.broadcasts();await assert.rejects(b.W.submit({...request,preparedAt:Math.floor(Date.now()/1000)}),e=>e.code==='wrong_network');assert.equal(b.broadcasts(),count);assert.equal(b.W.getState().connected,false);
const changed=boot();await changed.W.connect();const draft=await changed.W.prepareFaucet(token);changed.hook(()=>{changed.setAccount(recipient);changed.listeners.accountsChanged();});await assert.rejects(changed.W.submit(draft));assert.equal(changed.broadcasts(),0,'account change during preparation refuses');
const rejected=boot();await rejected.W.connect();rejected.sendError({code:4001,message:'user refused'});await assert.rejects(rejected.W.submit(await rejected.W.prepareFaucet(token)),e=>e.code==='wallet_rejected');
const uncertain=boot();await uncertain.W.connect();uncertain.sendError({message:'RPC ambiguous, secret bytes should not leak'});await assert.rejects(uncertain.W.submit(await uncertain.W.prepareFaucet(token)),e=>e.code==='submission_uncertain'&&!e.message.includes('secret'));assert.equal(uncertain.W.getState().lastSubmission.status,'unknown');
const missing=boot();missing.context.ethereum=null;await assert.rejects(missing.W.connect(),e=>e.code==='wallet_unavailable');
console.log('Trade wallet: pinned bundle, explicit user calls, chain97 only, exact code/token, calldata restrictions, no native trade value, account races, secret isolation and uncertain submissions PASS.');
