import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const context={crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array};context.window=context;context.self=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../../dist/vendor/ethers-6.15.0.umd.min.js',import.meta.url),'utf8'),context);const ethers=context.ethers;
for(const file of ['trade-core.js','trade-contracts.js','trade-session.js'])vm.runInContext(fs.readFileSync(new URL('../../dist/'+file,import.meta.url),'utf8'),context);
const c=context.NodusTradeCore,s=context.NodusTradeSession,a=context.NodusTradeContracts.contracts,now=1800000000;
const fields={name:'Session test',side:'sell_nodus',nodusAmount:'1000.00000001',usdtAmount:'10.123456789012345678',asset:{...c.EXAMPLE_ASSET},maker:{nodus:'0x'+'ab'.repeat(32),bsc:'0x'+'12'.repeat(20)},taker:{nodus:'0x'+'cd'.repeat(32),bsc:'0x'+'34'.repeat(20)}};
const contracts={nodus:'0x'+'ef'.repeat(32),bsc:'0x'+'78'.repeat(20)},code=expected=>error=>error.code===expected;
function observations(session,statuses=['empty','empty'],at=now){
 const o=session.offer;
 return Object.fromEntries(c.legs(o).map((leg,index)=>{
  const status=statuses[index],empty=status==='empty';
  return [leg.chain,{schema:'nodus-trade/observation-v1',available:true,chain:leg.chain,chainId:String(leg.chainId),contract:session.contracts[leg.chain],funder:leg.from,tradeId:o.id,...(leg.chain==='bsc'?{token:o.asset.token,decimals:18,tokenRuntime:a.mockUsdt.runtime}:{}),runtime:a[leg.chain].runtime,timestamp:String(at),height:'10',latestHeight:'12',status,recipient:empty?'0x'+'0'.repeat(leg.chain==='nodus'?64:40):leg.to,amountUnits:empty?'0':leg.amountUnits,hashlock:empty?'0x'+'0'.repeat(64):o.hashlock,refundAt:empty?'0':String(leg.refundAt),confirmed:true,source:'unit fixture only',independentVerification:false,checkedAt:at}];
 }));
}
for(const side of ['sell_nodus','buy_nodus']){
 const {offer,secret}=await c.create({...fields,side},now),session=s.createSession(offer,contracts),first=c.legs(offer)[0].chain,second=c.legs(offer)[1].chain;
 assert.equal(s.validateSession(session).schema,'nodus-trade/session-v1');assert.equal(s.exportSession(s.importSession(s.exportSession(session))),s.exportSession(session));
 assert(!s.exportSession(session).includes(secret));assert.equal(s.inspect(session,{},now).stage,'unverified');assert.equal(s.inspect(session,observations(session),now).stage,'unfunded');
 const approve=await s.request(session,'bsc','approve',observations(session),{now});assert.equal(approve.schema,'nodus-trade/wallet-request-v1');assert.equal(approve.from,c.legs(offer).find(x=>x.chain==='bsc').from);assert.equal(approve.to,offer.asset.token);assert.equal(approve.assetToken,offer.asset.token);assert.equal(approve.valueWei,'0');assert.equal(approve.notSent,true);assert.equal(approve.containsSecret,false);assert.equal(approve.preparedAt,now);assert.equal(approve.expiresAt,now+30);
 const approval=new ethers.Interface(['function approve(address,uint256)']).decodeFunctionData('approve',approve.data);assert.equal(approval[0].toLowerCase(),contracts.bsc);assert.equal(approval[1].toString(),c.amount(fields.usdtAmount,'bsc').units);
 await assert.rejects(s.request(session,'nodus','approve',observations(session),{now}),code('invalid_approval'));
 const makerOpen=await s.request(session,first,'open',observations(session),{now});assert.equal(makerOpen.from,offer.maker[first]);assert.equal(makerOpen.to,contracts[first]);assert.equal(makerOpen.containsSecret,false);assert(!makerOpen.data.includes(secret.slice(2)));
 if(first==='nodus'){
   assert.equal(makerOpen.valueWei,c.amount(fields.nodusAmount,'nodus').wei);assert.equal(makerOpen.data.length,10+64*4);assert.equal(makerOpen.data.slice(10+64,10+128),offer.taker.nodus.slice(2),'all 32 recipient bytes survive ABI encoding');assert.equal(makerOpen.data.slice(0,10),ethers.id('open(bytes32,address,bytes32,uint64)').slice(0,10));
 }else{const decoded=new ethers.Interface(a.bsc.abi).decodeFunctionData('open',makerOpen.data);assert.equal(decoded[3].toString(),c.amount(fields.usdtAmount,'bsc').units);assert.equal(makerOpen.valueWei,'0');}
 await assert.rejects(s.request(session,second,'open',observations(session),{now}),code('first_lock_required'));
 const takerOpen=await s.request(session,second,'open',observations(session,['locked','empty']),{now});assert.equal(takerOpen.from,offer.taker[second]);
 assert.equal(s.inspect(session,observations(session,['locked','empty']),now).stage,'maker_locked');assert.equal(s.inspect(session,observations(session,['locked','locked']),now).stage,'both_locked');
 await assert.rejects(s.request(session,second,'claim',observations(session,['locked','empty']),{secret,now}),code('not_locked'));
 await assert.rejects(s.request(session,first,'claim',observations(session,['locked','locked']),{secret,now}),code('secret_not_revealed'));
 await assert.rejects(s.request(session,second,'claim',observations(session,['locked','locked']),{secret:'0x'+'99'.repeat(32),now}),code('wrong_secret'));
 const claim=await s.request(session,second,'claim',observations(session,['locked','locked']),{secret,now});assert.equal(claim.from,offer.maker[second]);assert.equal(claim.valueWei,'0');assert.equal(claim.containsSecret,true);assert(claim.data.includes(secret.slice(2)));assert.equal(claim.data.length,10+64*3);
 if(second==='bsc'){const decoded=new ethers.Interface(a.bsc.abi).decodeFunctionData('claim',claim.data);assert.equal(decoded[0].toLowerCase(),offer.taker.bsc);assert.equal(decoded[2],secret);}else assert.equal(claim.data.slice(10,10+64),offer.taker.nodus.slice(2));
 const nearMargin=offer.takerRefundAt-c.MARGIN-1,edgeClaim=await s.request(session,second,'claim',observations(session,['locked','locked'],nearMargin),{secret,now:nearMargin});assert.equal(edgeClaim.expiresAt,nearMargin+1,'claim request cannot outlive its safety margin');
 const atMargin=offer.takerRefundAt-c.MARGIN;await assert.rejects(s.request(session,second,'claim',observations(session,['locked','locked'],atMargin),{secret,now:atMargin}),code('claim_margin_too_short'));
 const nearFund=offer.takerRefundAt-c.MIN_LOCK-1,edgeOpen=await s.request(session,first,'open',observations(session,['empty','empty'],nearFund),{now:nearFund});assert.equal(edgeOpen.expiresAt,nearFund+1,'funding request cannot outlive lock-readiness');
 const nearDeadline=offer.takerRefundAt-c.MARGIN+1;await assert.rejects(s.request(session,second,'claim',observations(session,['locked','locked'],nearDeadline),{secret,now:nearDeadline}),code('claim_margin_too_short'));
 assert.equal(s.inspect(session,observations(session,['locked','claimed']),now).stage,'first_claimed');
 const takerClaim=await s.request(session,first,'claim',observations(session,['locked','claimed']),{secret,now});assert.equal(takerClaim.from,offer.taker[first]);assert.equal(takerClaim.containsSecret,true);const lastSecond=offer.makerRefundAt-1,lastClaim=await s.request(session,first,'claim',observations(session,['locked','claimed'],lastSecond),{secret,now:lastSecond});assert.equal(lastClaim.expiresAt,lastSecond+1,'second claim request expires at its own refund boundary');assert.equal(s.inspect(session,observations(session,['claimed','claimed']),now).stage,'settled');
 assert.equal(s.inspect(session,observations(session,['locked','refunded']),now).stage,'refund_pending');assert.equal(s.inspect(session,observations(session,['refunded','locked']),now).stage,'refund_pending');assert.equal(s.inspect(session,observations(session,['refunded','refunded']),now).stage,'refunded');assert.equal(s.inspect(session,observations(session,['refunded','empty']),now).stage,'refunded');assert.equal(s.inspect(session,observations(session,['claimed','refunded']),now).stage,'partial_settlement');
 const at=offer.makerRefundAt,refundObs=observations(session,['locked','empty'],at);delete refundObs[second];const refund=await s.request(session,first,'refund',refundObs,{now:at});assert.equal(refund.from,offer.maker[first]);assert.equal(refund.valueWei,'0');assert.equal(refund.containsSecret,false);
 await assert.rejects(s.request(session,first,'refund',observations(session,['locked','empty'],at-1),{now:at-1}),code('refund_not_ready'));
 const nodusUnavailable=observations(session);nodusUnavailable.nodus={...nodusUnavailable.nodus,runtime:null,runtimeVerified:false,confirmed:false,blocker:'nodus_runtime_unavailable'};
 assert.equal(s.inspect(session,nodusUnavailable,now).valid,false);assert(s.inspect(session,nodusUnavailable,now).legs.nodus.errors.includes('runtime_unverified'));
 await s.request(session,'bsc','approve',nodusUnavailable,{now});
 await assert.rejects(s.request(session,'bsc','open',nodusUnavailable,{now}),code('network_unverified'));
 await assert.rejects(s.request(session,'nodus','open',nodusUnavailable,{now}),code('network_unverified'));
 const locked=observations(session,['locked','locked']);locked.nodus={...locked.nodus,runtime:null,confirmed:false};await assert.rejects(s.request(session,'bsc','claim',locked,{secret,now}),code('network_unverified'));
 for(const chain of ['nodus','bsc']){
   for(const patch of [{contract:chain==='nodus'?offer.maker.nodus:offer.maker.bsc},{funder:'0x'+'99'.repeat(chain==='nodus'?32:20)},{tradeId:'0x'+'99'.repeat(32)},{chainId:'56'},{runtime:'0x00'},{confirmed:false},{checkedAt:now-31},{checkedAt:now+6},{timestamp:String(now+121)},{height:'0'},{height:'13'},{height:'invalid'},{latestHeight:'invalid'},{independentVerification:true}]){
     const obs=observations(session);obs[chain]={...obs[chain],...patch};assert.equal(s.inspect(session,obs,now).valid,false,chain+JSON.stringify(patch));await assert.rejects(s.request(session,first,'open',obs,{now}),code('network_unverified'));
   }
   const obs=observations(session,['locked','locked']);for(const patch of [{recipient:'0x'+'99'.repeat(chain==='nodus'?32:20)},{amountUnits:'1'},{hashlock:'0x'+'00'.repeat(32)},{refundAt:'1'}]){const changed={...obs,[chain]:{...obs[chain],...patch}};assert.equal(s.inspect(session,changed,now).valid,false);}
 }
 for(const patch of [{token:contracts.bsc},{decimals:6},{tokenRuntime:'0x00'}]){const obs=observations(session);obs.bsc={...obs.bsc,...patch};assert.equal(s.inspect(session,obs,now).valid,false);await assert.rejects(s.request(session,'bsc','approve',obs,{now}),code('network_unverified'));}
 const entry={chain:'bsc',action:'claim',hash:'0x'+'56'.repeat(32),submittedAt:now},recorded=s.recordTransaction(session,entry);assert.equal(session.transactions.length,0);assert.equal(recorded.transactions.length,1);assert.equal(s.recordTransaction(recorded,entry).transactions.length,1);assert(!s.exportSession(recorded).includes(secret));
 assert.throws(()=>s.recordTransaction(session,{...entry,secret}));assert.throws(()=>s.validateSession({...session,observations:locked}));assert.throws(()=>s.validateSession({...session,secret}));assert.throws(()=>s.importSession(JSON.stringify({...session,transactions:[{...entry,data:claim.data}]})));
 await assert.rejects(s.request(session,'nodus','withdraw',locked,{now}),code('invalid_request'));
}
assert.throws(()=>s.importSession('x'.repeat(s.MAX_BYTES+1)));assert.throws(()=>s.importSession('{'));
console.log('Trade session: strict public recovery, fresh code/token/term checks, fail-closed Nodus runtime, first-lock/claim ordering, refund recovery, exact 32/20-byte ABI requests and secret-free session exports PASS.');
