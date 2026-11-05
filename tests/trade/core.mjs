import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const context={crypto:webcrypto,TextEncoder,Uint8Array};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../../dist/trade-core.js',import.meta.url),'utf8'),context);const c=context.NodusTradeCore;
const now=1800000000;
const fields={name:'My token trade',side:'sell_nodus',nodusAmount:'123456789012345.12345678',usdtAmount:'0.000000000000000001',asset:{...c.EXAMPLE_ASSET},maker:{nodus:'0x'+'ab'.repeat(32),bsc:'0x'+'12'.repeat(20)},taker:{nodus:'0x'+'cd'.repeat(32),bsc:'0x'+'34'.repeat(20)}};
const code=expected=>error=>error.code===expected;
assert.equal(c.SCHEMA,'nodus-trade/offer-v2');assert.equal(c.RECOVERY,'nodus-trade/recovery-v2');
assert.equal(c.amount(fields.nodusAmount,'nodus').raw,'12345678901234512345678');assert.equal(c.amount(fields.nodusAmount,'nodus').wei,'123456789012345123456780000000000');
assert.equal(c.amount(fields.usdtAmount,'bsc').units,'1');assert(!Object.hasOwn(c.amount('10','bsc'),'wei'),'a token amount is not native BNB msg.value');
assert.equal(c.amount('10.123456789012345678','bsc').raw,'10123456789012345678');
for(const chain of ['nodus','bsc'])for(const invalid of ['-1','0','1e5',' 1','1,2','01','1.','Infinity','9'.repeat(79)])assert.throws(()=>c.amount(invalid,chain));
assert.throws(()=>c.amount('0.000000001','nodus'));assert.throws(()=>c.amount('0.0000000000000000001','bsc'));assert.throws(()=>c.amount('1','bnb'));
const tokenMaximum=(1n<<256n)-1n,asTokens=raw=>`${raw/10n**18n}.${String(raw%10n**18n).padStart(18,'0')}`;
assert.equal(c.amount(asTokens(tokenMaximum),'bsc').units,tokenMaximum.toString());assert.throws(()=>c.amount(asTokens(tokenMaximum+1n),'bsc'));
assert.equal(c.BSC_MAINNET_USDT.chainId,56);assert.equal(c.BSC_MAINNET_USDT.decimals,18);assert.equal(c.BSC_MAINNET_USDT.token,'0x55d398326f99059ff775485246999027b3197955');
async function lockBoth(offer,state){
  let result=state;
  for(let i=0;i<2;i++){
    if(result.legs[i].chain==='bsc')result=await c.step(offer,result,`approve:${i}`,{actor:result.legs[i].funder});
    result=await c.step(offer,result,`lock:${i}`,{actor:result.legs[i].funder});
  }
  return result;
}
for(const side of ['sell_nodus','buy_nodus']){
 const {offer,secret}=await c.create({...fields,side},now);assert.equal(await c.hash(secret),'0x'+createHash('sha256').update(Buffer.from(secret.slice(2),'hex')).digest('hex'));
 const pub=c.exportOffer(offer);assert(!pub.includes(secret));assert.equal(c.exportOffer(c.importOffer(pub)),pub);assert.equal((await c.importRecovery(await c.recovery(offer,secret))).secret,secret);
 const plan=c.plan(offer);assert(!JSON.stringify(plan).includes(secret));assert.equal(plan.schema,'nodus-trade/plan-v2');assert.equal(plan.transactionsSent,false);
 assert.equal(c.legs(offer)[0].chain,side==='sell_nodus'?'nodus':'bsc');
 const tokenPlan=plan.steps.find(x=>x.chain==='bsc'),nativePlan=plan.steps.find(x=>x.chain==='nodus');
 assert.equal(tokenPlan.open.valueWei,'0');assert.equal(tokenPlan.open.signature,'open(bytes32,address,bytes32,uint256,uint64)');assert.equal(tokenPlan.open.args[3],'1');assert.equal(tokenPlan.open.args.length,5);
 assert.equal(tokenPlan.approval.token,offer.asset.token);assert.equal(tokenPlan.approval.exactAllowanceUnits,'1');assert.equal(tokenPlan.approval.approve.args[1],'1');assert.equal(tokenPlan.approval.resetIfNonzero.args[1],'0');assert.equal(tokenPlan.approval.approve.valueWei,'0');
 assert.equal(tokenPlan.deployment.args[0],offer.asset.token);assert.equal(tokenPlan.feeCurrency,'tBNB');assert.equal(nativePlan.open.valueWei,c.amount(fields.nodusAmount,'nodus').wei);assert.equal(nativePlan.approval,undefined);
 let s=c.start(offer,now);const tokenIndex=s.legs.findIndex(x=>x.chain==='bsc'),nativeIndex=1-tokenIndex;
 assert.equal(s.legs[tokenIndex].allowanceUnits,'0');await assert.rejects(c.step(offer,s,`approve:${nativeIndex}`,{actor:s.legs[nativeIndex].funder}),code('invalid_approval'));
 await assert.rejects(c.step(offer,s,`approve:${tokenIndex}`,{actor:s.legs[tokenIndex].recipient}),code('unauthorized'));
 await assert.rejects(c.step(offer,s,'lock:1',{actor:'taker'}),code('first_lock_required'));
 if(tokenIndex===1)s=await c.step(offer,s,'lock:0',{actor:'maker'});
 const unapproved=JSON.stringify(s);await assert.rejects(c.step(offer,s,`lock:${tokenIndex}`,{actor:s.legs[tokenIndex].funder}),code('approval_required'));assert.equal(JSON.stringify(s),unapproved);
 s=await c.step(offer,s,`approve:${tokenIndex}`,{actor:s.legs[tokenIndex].funder});assert.equal(s.legs[tokenIndex].allowanceUnits,'1');
 const approved=JSON.stringify(s);await assert.rejects(c.step(offer,s,`lock:${tokenIndex}`,{actor:s.legs[tokenIndex].funder,paymentSucceeds:false}),code('payment_failed'));assert.equal(JSON.stringify(s),approved,'failed token funding preserves allowance and prior state');
 s=await c.step(offer,s,`lock:${tokenIndex}`,{actor:s.legs[tokenIndex].funder});assert.equal(s.legs[tokenIndex].allowanceUnits,'0');
 if(nativeIndex===1)s=await c.step(offer,s,'lock:1',{actor:'taker'});
 await assert.rejects(c.step(offer,s,`approve:${tokenIndex}`,{actor:s.legs[tokenIndex].funder}),code('already_locked'));
 const original=JSON.stringify(s);
 for(const options of [{actor:'taker',secret},{actor:'maker',secret:'0x'+'99'.repeat(32)},{actor:'maker',secret,paymentSucceeds:false}])await assert.rejects(c.step(offer,s,'claim:1',options));
 assert.equal(JSON.stringify(s),original,'rejected commands preserve prior state');
 s=await c.step(offer,s,'claim:1',{actor:'maker',secret});s=await c.step(offer,s,'claim:0',{actor:'taker',secret});assert(s.legs.every(x=>x.status==='claimed'));
 await assert.rejects(c.step(offer,s,'claim:0',{actor:'taker',secret}));
 let r=await lockBoth(offer,c.start(offer,now));
 await assert.rejects(c.step(offer,r,'refund:1',{actor:'taker',now:offer.takerRefundAt-1}));await assert.rejects(c.step(offer,r,'claim:1',{actor:'maker',secret,now:offer.takerRefundAt}));
 r=await c.step(offer,r,'refund:1',{actor:'taker',now:offer.takerRefundAt});r=await c.step(offer,r,'refund:0',{actor:'maker',now:offer.makerRefundAt});assert(r.legs.every(x=>x.status==='refunded'));
 for(const [i,leg] of c.legs(offer).entries()){
   const obs={chainId:String(leg.chainId),tradeId:offer.id,funder:leg.from,recipient:leg.to,amountUnits:leg.amountUnits,hashlock:offer.hashlock,refundAt:String(leg.refundAt),status:'locked',confirmed:true,runtimeVerified:true,...(leg.chain==='bsc'?{token:leg.token,decimals:String(leg.decimals)}:{amountWei:leg.amountWei})};assert(c.verifyLock(offer,i,obs,now).valid);
   for(const key of Object.keys(obs))assert(!c.verifyLock(offer,i,{...obs,[key]:'wrong'},now).valid,`${leg.chain}:${key}`);
   assert(!c.verifyLock(offer,i,obs,leg.refundAt).valid);
 }
 const modifications=[{secret},{bnbAmount:'1'},{schema:'other'},{maker:{...offer.maker,nodus:fields.maker.bsc}},{taker:offer.maker},{makerRefundAt:offer.takerRefundAt+1},...[
   {chainId:56},{chainId:'97'},{kind:'native'},{symbol:'USDT'},{symbol:'tBNB'},{decimals:6},{decimals:'18'},{token:'0x'+'0'.repeat(40)},{token:'0x'+'11'.repeat(32)},{token:null},{extra:true}
 ].map(changes=>({asset:{...offer.asset,...changes}}))];
 for(const modification of modifications)assert.throws(()=>c.validate({...offer,...modification}));
 assert.throws(()=>c.readiness(offer,offer.takerRefundAt));
 const normalized=c.validate({...offer,asset:{...offer.asset,token:offer.asset.token.toUpperCase().replace('0X','0x')}});assert.equal(normalized.asset.token,offer.asset.token);
 assert.throws(()=>c.validate({...offer,schema:'nodus-trade/offer-v1'}),code('legacy_bnb_offer'));
 assert.throws(()=>c.importOffer(JSON.stringify({schema:'nodus-trade/offer-v1',bnbAmount:'10'})),code('legacy_bnb_offer'));
 await assert.rejects(c.importRecovery(JSON.stringify({schema:'nodus-trade/recovery-v1',offer,secret})),code('legacy_bnb_offer'));
 await assert.rejects(c.create({...fields,asset:{...fields.asset,chainId:56}},now),code('wrong_network'));
}
assert.throws(()=>c.importOffer('{"__proto__":{"polluted":true}}'));assert.throws(()=>c.importOffer('x'.repeat(16385)));
console.log('Trade USDT core: strict v2 asset identity, exact token units, approval before funding, no native BNB value, both directions, lock verification, secret isolation, claim/refund boundaries and legacy rejection PASS.');
