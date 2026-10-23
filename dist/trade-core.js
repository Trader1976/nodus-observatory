/* NODUS–TEST-USDT authoring and simulation. No network, wallet or signing access. */
(() => {
  'use strict';
  const SCHEMA='nodus-trade/offer-v2', RECOVERY='nodus-trade/recovery-v2';
  // The example address is fictional; it is never a statement that a token is deployed there.
  const EXAMPLE_ASSET=Object.freeze({kind:'bep20',chainId:97,token:'0x'+'55'.repeat(20),decimals:18,symbol:'TEST-USDT'});
  // Informational production identity only. v2 offers accept chain 97 test tokens, never this chain 56 asset.
  const BSC_MAINNET_USDT=Object.freeze({chainId:56,token:'0x55d398326f99059ff775485246999027b3197955',decimals:18,symbol:'Binance-Peg USDT'});
  const NODUS_CHAIN='a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114';
  const MAX_BYTES=16384, MAX_UINT=(1n<<256n)-1n, MIN_LOCK=3600, MAX_LOCK=604800, MARGIN=7200;
  const HEX=/^0x[0-9a-f]{64}$/, ZERO='0x'+'0'.repeat(64);
  const copy=x=>JSON.parse(JSON.stringify(x));
  function fail(code,field=''){throw Object.assign(new Error(code),{code,field});}
  function object(x,keys,field){if(!x||Array.isArray(x)||typeof x!=='object'||Object.keys(x).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(x,k)))fail('invalid_schema',field);}
  function bytes32(x,field){if(typeof x!=='string'||!HEX.test(x)||x===ZERO)fail('invalid_hash',field);return x;}
  function address(x,chain,field){if(!['nodus','bsc'].includes(chain)||typeof x!=='string'||!new RegExp('^0x[0-9a-fA-F]{'+(chain==='nodus'?64:40)+'}$').test(x)||/^0x0+$/.test(x))fail('invalid_address',field);return x.toLowerCase();}
  function amount(text,chain){
    if(!['nodus','bsc'].includes(chain))fail('invalid_amount',chain);
    const digits=chain==='nodus'?8:18;
    if(typeof text!=='string'||text.length>80||!new RegExp('^(0|[1-9][0-9]*)(\\.[0-9]{1,'+digits+'})?$').test(text))fail('invalid_amount',chain);
    const [a,b='']=text.split('.'),raw=BigInt(a)*10n**BigInt(digits)+BigInt((b+'0'.repeat(digits)).slice(0,digits)),units=chain==='nodus'?raw*10000000000n:raw;
    if(units<=0n||units>MAX_UINT)fail('invalid_amount',chain);
    return chain==='nodus'?{raw:raw.toString(),units:units.toString(),wei:units.toString()}:{raw:raw.toString(),units:units.toString()};
  }
  function asset(input){
    object(input,['kind','chainId','token','decimals','symbol'],'asset');
    if(input.chainId!==97)fail('wrong_network','asset.chainId');
    if(input.kind!=='bep20'||input.decimals!==18||input.symbol!=='TEST-USDT')fail('invalid_asset','asset');
    return {...copy(input),token:address(input.token,'bsc','asset.token')};
  }
  function validate(input){
    if(input?.schema==='nodus-trade/offer-v1')fail('legacy_bnb_offer');
    object(input,['schema','id','name','side','nodusAmount','usdtAmount','maker','taker','hashlock','makerRefundAt','takerRefundAt','nodusChainId','asset','createdAt'],'offer');
    if(input.schema!==SCHEMA||!['sell_nodus','buy_nodus'].includes(input.side))fail('invalid_schema');
    bytes32(input.id,'id');bytes32(input.hashlock,'hashlock');
    if(typeof input.name!=='string'||input.name!==input.name.trim()||!input.name||input.name.length>80||/[\u0000-\u001f\u007f]/.test(input.name))fail('invalid_name','name');
    amount(input.nodusAmount,'nodus');amount(input.usdtAmount,'bsc');
    if(input.nodusChainId!==NODUS_CHAIN)fail('wrong_network');
    if(!Number.isSafeInteger(input.createdAt)||input.createdAt<0||input.createdAt>253402300799-MAX_LOCK)fail('invalid_deadline');
    for(const key of ['makerRefundAt','takerRefundAt'])if(!Number.isSafeInteger(input[key])||input[key]<=input.createdAt||input[key]>input.createdAt+MAX_LOCK)fail('invalid_deadline',key);
    if(input.takerRefundAt<input.createdAt+MIN_LOCK||input.makerRefundAt-input.takerRefundAt<MARGIN)fail('unsafe_deadlines');
    const result=copy(input);result.asset=asset(input.asset);
    for(const party of ['maker','taker']){object(input[party],['nodus','bsc'],party);for(const chain of ['nodus','bsc'])result[party][chain]=address(input[party][chain],chain,party+'.'+chain);}
    for(const chain of ['nodus','bsc'])if(result.maker[chain]===result.taker[chain])fail('same_party',chain);
    return result;
  }
  function parse(text){if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES)fail('file_too_large');try{return JSON.parse(text);}catch{fail('invalid_json');}}
  function exportOffer(offer){return JSON.stringify(validate(offer),null,2)+'\n';}
  function importOffer(text){return validate(parse(text));}
  function random(){if(!globalThis.crypto?.getRandomValues)fail('crypto_unavailable');const a=crypto.getRandomValues(new Uint8Array(32));return '0x'+Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');}
  async function hash(secret){bytes32(secret,'secret');if(!globalThis.crypto?.subtle)fail('crypto_unavailable');const a=Uint8Array.from(secret.slice(2).match(/../g),x=>parseInt(x,16));return '0x'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a)),x=>x.toString(16).padStart(2,'0')).join('');}
  async function create(fields,now=Math.floor(Date.now()/1000)){
    const secret=random(), offer=validate({schema:SCHEMA,id:random(),name:fields.name,side:fields.side,nodusAmount:fields.nodusAmount,usdtAmount:fields.usdtAmount,maker:fields.maker,taker:fields.taker,hashlock:await hash(secret),createdAt:now,makerRefundAt:now+86400,takerRefundAt:now+43200,nodusChainId:NODUS_CHAIN,asset:fields.asset});
    return {offer,secret};
  }
  async function recovery(offer,secret){const o=validate(offer);if(await hash(secret)!==o.hashlock)fail('wrong_secret');return JSON.stringify({schema:RECOVERY,offer:o,secret},null,2)+'\n';}
  async function importRecovery(text){const x=parse(text);if(x?.schema==='nodus-trade/recovery-v1')fail('legacy_bnb_offer');object(x,['schema','offer','secret'],'recovery');if(x.schema!==RECOVERY)fail('invalid_schema');const offer=validate(x.offer);if(await hash(x.secret)!==offer.hashlock)fail('wrong_secret');return {offer,secret:x.secret};}
  function legs(input){
    const o=validate(input),first=o.side==='sell_nodus'?'nodus':'bsc',second=first==='nodus'?'bsc':'nodus';
    return [first,second].map((chain,i)=>{
      const units=amount(o[chain==='nodus'?'nodusAmount':'usdtAmount'],chain).units;
      return {chain,funder:i?'taker':'maker',recipient:i?'maker':'taker',from:o[i?'taker':'maker'][chain],to:o[i?'maker':'taker'][chain],amountUnits:units,...(chain==='nodus'?{amountWei:units}:{token:o.asset.token,decimals:o.asset.decimals}),refundAt:o[i?'takerRefundAt':'makerRefundAt'],chainId:chain==='nodus'?NODUS_CHAIN:97};
    });
  }
  function readiness(input,now){const o=validate(input);if(!Number.isSafeInteger(now)||o.takerRefundAt-now<MIN_LOCK)fail('offer_expired');return true;}
  function plan(input){
    const o=validate(input),spender='DEPLOYED_BSC_SWAP_ADDRESS';
    return {schema:'nodus-trade/plan-v2',offer:o,mode:'testnet-preparation',deployed:false,transactionsSent:false,steps:legs(o).map(leg=>({
      ...leg,contract:leg.chain==='nodus'?'ObservatoryNodusSwap':'ObservatoryBscUsdtSwap',
      ...(leg.chain==='bsc'?{deployment:{constructorSignature:'constructor(address)',args:[leg.token]},feeCurrency:'tBNB',approval:{token:leg.token,spender,exactAllowanceUnits:leg.amountUnits,resetIfNonzero:{signature:'approve(address,uint256)',args:[spender,'0'],valueWei:'0'},approve:{signature:'approve(address,uint256)',args:[spender,leg.amountUnits],valueWei:'0'}}}:{}),
      open:leg.chain==='nodus'?{signature:'open(bytes32,address,bytes32,uint64)',args:[o.id,leg.to,o.hashlock,String(leg.refundAt)],valueWei:leg.amountWei}:{signature:'open(bytes32,address,bytes32,uint256,uint64)',args:[o.id,leg.to,o.hashlock,leg.amountUnits,String(leg.refundAt)],valueWei:'0'},
      claim:{signature:'claim(address,bytes32,bytes32)',args:[leg.from,o.id,'PRIVATE_SECRET_ONLY_AFTER_BOTH_LOCKS_VERIFIED'],valueWei:'0'},refund:{signature:'refund(bytes32)',args:[o.id],valueWei:'0'}
    })),requirements:['Verify chain identity, deployed runtime code, and the fixed token contract address.','Verify token decimals and exact token units; token amounts are not native BNB msg.value.','Approve only the exact token amount to the verified swap contract; if an existing allowance is nonzero, reset it to zero first.','Verify both funders, recipients, amounts, hashlock and deadlines on confirmed chain state.','The maker deadline must exceed the taker deadline by the agreed safety margin.','Monitor both chains until claim or refund; refunds require transactions.','tBNB is required separately for BSC testnet transaction fees.']};
  }
  function start(input,now=Math.floor(Date.now()/1000)){const o=validate(input);readiness(o,now);return {offerId:o.id,now,legs:legs(o).map(x=>({...x,status:'empty',...(x.chain==='bsc'?{allowanceUnits:'0'}:{})})),secretRevealed:false,events:[]};}
  async function step(input,state,action,{secret='',actor='',now=state.now,paymentSucceeds=true}={}){
    const o=validate(input);if(state.offerId!==o.id||!Number.isSafeInteger(now)||now<state.now)fail('invalid_simulation');const next=copy(state);next.now=now;
    if(action==='advance'){next.events.push({action,now});return next;}
    const [kind,indexText]=String(action).split(':'),index=Number(indexText),leg=next.legs[index];if(![0,1].includes(index)||!leg)fail('invalid_simulation');
    if(kind==='approve'){
      if(leg.chain!=='bsc')fail('invalid_approval');if(actor!==leg.funder)fail('unauthorized');if(leg.status!=='empty')fail('already_locked');
      if(leg.refundAt<now+MIN_LOCK)fail('offer_expired');leg.allowanceUnits=leg.amountUnits;
    }else if(kind==='lock'){
      if(actor!==leg.funder)fail('unauthorized');if(leg.status!=='empty')fail('already_locked');if(leg.refundAt<now+MIN_LOCK||leg.refundAt>now+MAX_LOCK)fail('offer_expired');
      if(index===1&&next.legs[0].status!=='locked')fail('first_lock_required');
      if(!paymentSucceeds)fail('payment_failed');
      if(leg.chain==='bsc'){if(leg.allowanceUnits!==leg.amountUnits)fail('approval_required');leg.allowanceUnits='0';}leg.status='locked';
    }else if(kind==='claim'){
      if(leg.status!=='locked')fail('not_locked');if(actor!==leg.recipient)fail('unauthorized');if(now>=leg.refundAt)fail('claim_expired');if(await hash(secret)!==o.hashlock)fail('wrong_secret');
      // The maker reveals only after both locks have been checked in this rehearsal.
      if(index===1&&next.legs[0].status!=='locked')fail('first_lock_required');
      if(index===0&&!next.secretRevealed)fail('secret_not_revealed');if(!paymentSucceeds)fail('payment_failed');leg.status='claimed';next.secretRevealed=true;
    }else if(kind==='refund'){
      if(actor!==leg.funder)fail('unauthorized');if(leg.status!=='locked')fail('not_locked');if(now<leg.refundAt)fail('refund_not_ready');if(!paymentSucceeds)fail('payment_failed');leg.status='refunded';
    }else fail('invalid_simulation');
    next.events.push({action,actor,now,chain:leg.chain});return next;
  }
  // Compare independently obtained chain data; never infer a funded lock from a draft.
  function verifyLock(input,index,observed,now){
    const o=validate(input),leg=legs(o)[index],errors=[];if(!leg)return {valid:false,errors:['invalid_leg']};
    const expected={chainId:String(leg.chainId),tradeId:o.id,funder:leg.from,recipient:leg.to,amountUnits:leg.amountUnits,hashlock:o.hashlock,refundAt:String(leg.refundAt),status:'locked',...(leg.chain==='bsc'?{token:leg.token,decimals:String(leg.decimals)}:{amountWei:leg.amountWei})};
    for(const [key,want] of Object.entries(expected))if(String(observed?.[key])!==want)errors.push(key);
    if(observed?.confirmed!==true)errors.push('confirmed');if(observed?.runtimeVerified!==true)errors.push('runtimeVerified');if(!Number.isSafeInteger(now)||now>=leg.refundAt)errors.push('expired');return {valid:errors.length===0,errors};
  }
  const api={SCHEMA,RECOVERY,NODUS_CHAIN,EXAMPLE_ASSET,BSC_MAINNET_USDT,MIN_LOCK,MAX_LOCK,MARGIN,MAX_BYTES,validate,amount,address,exportOffer,importOffer,create,hash,recovery,importRecovery,legs,readiness,plan,start,step,verifyLock,copy};
  globalThis.NodusTradeCore=Object.freeze(api);
})();
