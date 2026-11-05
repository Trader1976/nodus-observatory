/* Public trade sessions and unsigned developer handoff. Reads no keys and sends no transaction. */
(() => {
  'use strict';
  const SCHEMA='nodus-trade/session-v1',REQUEST='nodus-trade/wallet-request-v1',MAX_BYTES=128*1024,FRESH_SECONDS=30,CLOCK_SKEW=120;
  const C=()=>globalThis.NodusTradeCore,A=()=>globalThis.NodusTradeContracts.contracts,E=()=>globalThis.ethers;
  const copy=x=>JSON.parse(JSON.stringify(x)),seconds=()=>Math.floor(Date.now()/1000),ZERO='0x'+'0'.repeat(64);
  function fail(code,field=''){throw Object.assign(new Error(code),{code,field});}
  function object(x,keys,field){if(!x||typeof x!=='object'||Array.isArray(x)||keys.some(k=>!Object.hasOwn(x,k))||Object.keys(x).some(k=>!keys.includes(k)))fail('invalid_session',field);}
  function time(now){if(!Number.isSafeInteger(now)||now<0)fail('invalid_time');return now;}
  function uint(x){return typeof x==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(x)&&BigInt(x)<(1n<<256n);}
  function transaction(input){
    object(input,['chain','action','hash','submittedAt'],'transaction');
    if(!['nodus','bsc'].includes(input.chain)||!['approve','open','claim','refund','deploy'].includes(input.action)||typeof input.hash!=='string'||!(input.chain==='bsc'?/^0x[0-9a-fA-F]{64}$/:/^0x(?:[0-9a-fA-F]{64}|[0-9a-fA-F]{128})$/).test(input.hash))fail('invalid_session','transaction');
    time(input.submittedAt);return {...copy(input),hash:input.hash.toLowerCase()};
  }
  function validateSession(input){
    object(input,['schema','offer','contracts','transactions'],'session');if(input.schema!==SCHEMA)fail('invalid_session');
    const offer=C().validate(input.offer);object(input.contracts,['nodus','bsc'],'contracts');
    const contracts=Object.fromEntries(['nodus','bsc'].map(chain=>[chain,C().address(input.contracts[chain],chain,'contracts.'+chain)]));
    if(contracts.bsc===offer.asset.token)fail('invalid_session','contracts.bsc');
    if(!Array.isArray(input.transactions)||input.transactions.length>128)fail('invalid_session','transactions');
    const transactions=input.transactions.map(transaction);return {schema:SCHEMA,offer,contracts,transactions};
  }
  function createSession(offer,contracts){return validateSession({schema:SCHEMA,offer,contracts,transactions:[]});}
  function exportSession(input){return JSON.stringify(validateSession(input),null,2)+'\n';}
  function importSession(text){if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES)fail('file_too_large');let parsed;try{parsed=JSON.parse(text);}catch{fail('invalid_json');}return validateSession(parsed);}
  function recordTransaction(input,entry){const s=validateSession(input),next=transaction(entry);if(s.transactions.some(x=>x.chain===next.chain&&x.hash===next.hash))return s;if(s.transactions.length>=128)fail('invalid_session','transactions');s.transactions.push(next);return s;}
  function checkObservation(s,chain,o,now){
    const leg=C().legs(s.offer).find(x=>x.chain===chain),errors=[],expected={schema:'nodus-trade/observation-v1',chain,chainId:String(leg.chainId),contract:s.contracts[chain],funder:leg.from,tradeId:s.offer.id};
    if(!o||o.available!==true)return {valid:false,verified:false,available:false,status:'unknown',errors:['observation_unavailable']};
    for(const [key,want] of Object.entries(expected))if(o[key]!==want)errors.push(key);
    if(o.confirmed!==true)errors.push('unconfirmed');
    if(o.runtimeVerified===false||typeof o.runtime!=='string'||o.runtime.toLowerCase()!==A()[chain].runtime.toLowerCase())errors.push('runtime_unverified');
    if(o.independentVerification!==false)errors.push('verification_mode');
    if(!Number.isSafeInteger(o.checkedAt)||o.checkedAt>now+5||now-o.checkedAt>FRESH_SECONDS)errors.push('observation_stale');
    if(!uint(o.height)||!uint(o.latestHeight)||BigInt(o.height||'0')===0n||uint(o.height)&&uint(o.latestHeight)&&BigInt(o.height)>BigInt(o.latestHeight))errors.push('block_height');
    const timestamp=uint(o.timestamp)&&BigInt(o.timestamp)<=BigInt(Number.MAX_SAFE_INTEGER)?Number(o.timestamp):null;
    if(timestamp===null||Math.abs(now-timestamp)>CLOCK_SKEW)errors.push('chain_clock');
    if(!['empty','locked','claimed','refunded'].includes(o.status))errors.push('status');
    if(chain==='bsc'){
      if(o.token!==s.offer.asset.token)errors.push('token');if(String(o.decimals)!==String(s.offer.asset.decimals))errors.push('decimals');
      if(typeof o.tokenRuntime!=='string'||o.tokenRuntime.toLowerCase()!==A().mockUsdt.runtime.toLowerCase())errors.push('token_runtime_unverified');
    }
    if(o.status==='empty'){
      if(o.amountUnits!=='0'||o.hashlock!==ZERO||o.refundAt!=='0'||o.recipient!=='0x'+'0'.repeat(chain==='nodus'?64:40))errors.push('empty_state');
    }else{
      for(const [key,want] of Object.entries({recipient:leg.to,amountUnits:leg.amountUnits,hashlock:s.offer.hashlock,refundAt:String(leg.refundAt)}))if(String(o[key])!==want)errors.push(key);
    }
    return {valid:errors.length===0,verified:errors.length===0,available:true,status:o.status||'unknown',errors,timestamp,height:o.height,checkedAt:o.checkedAt};
  }
  function inspect(input,observations={},now=seconds()){
    const s=validateSession(input);time(now);const legs=Object.fromEntries(['nodus','bsc'].map(chain=>[chain,checkObservation(s,chain,observations?.[chain],now)])),ordered=C().legs(s.offer).map(x=>legs[x.chain]);
    const valid=Object.values(legs).every(x=>x.valid);let stage='unverified';
    if(valid){const [first,second]=ordered.map(x=>x.status);stage=first==='claimed'&&second==='claimed'?'settled':[first,second].includes('claimed')&&[first,second].includes('refunded')?'partial_settlement':[first,second].includes('refunded')?([first,second].includes('locked')?'refund_pending':[first,second].every(x=>['refunded','empty'].includes(x))?'refunded':'inconsistent'):first==='locked'&&second==='claimed'?'first_claimed':first==='locked'&&second==='locked'?'both_locked':first==='locked'&&second==='empty'?'maker_locked':first==='empty'&&second==='empty'?'unfunded':'inconsistent';}
    return {valid,verified:valid,stage,legs,errors:Object.entries(legs).flatMap(([chain,x])=>x.errors.map(error=>chain+':'+error)),independentVerification:false};
  }
  function encodeNodus(signature,args){
    if(!E()?.id)fail('encoding_unavailable');
    return E().id(signature).slice(0,10)+args.map(x=>{
      if(typeof x==='string'&&/^0x[0-9a-f]{64}$/.test(x))return x.slice(2);
      if(typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)&&BigInt(x)<(1n<<256n))return BigInt(x).toString(16).padStart(64,'0');
      fail('invalid_request','argument');
    }).join('');
  }
  async function request(input,chain,action,observations={},options={}){
    const s=validateSession(input),now=time(options.now??seconds());
    if(!['nodus','bsc'].includes(chain)||!['approve','open','claim','refund'].includes(action))fail('invalid_request');
    if(action==='approve'&&chain!=='bsc')fail('invalid_approval');
    const report=inspect(s,observations,now),leg=C().legs(s.offer).find(x=>x.chain===chain),index=C().legs(s.offer).findIndex(x=>x.chain===chain),own=report.legs[chain],otherChain=chain==='nodus'?'bsc':'nodus',other=report.legs[otherChain];
    if(!own.valid)fail('network_unverified',chain);
    if((action==='open'||action==='claim')&&!report.valid)fail('network_unverified',otherChain);
    const clock=Math.max(now,own.timestamp??now,other.valid?other.timestamp:now),remaining=leg.refundAt-clock;
    let signature,args,from=leg.from,to=s.contracts[chain],valueWei='0',safetyUntil=now+FRESH_SECONDS;
    if(action==='approve'||action==='open'){
      if(own.status!=='empty')fail('already_locked');C().readiness(s.offer,clock);
      if(remaining<C().MIN_LOCK||remaining>C().MAX_LOCK)fail('offer_expired');
      safetyUntil=Math.min(safetyUntil,now+s.offer.takerRefundAt-clock-C().MIN_LOCK,now+remaining-C().MIN_LOCK);if(safetyUntil<=now)fail('offer_expired');
      if(action==='approve'){signature='approve(address,uint256)';args=[s.contracts.bsc,leg.amountUnits];to=s.offer.asset.token;}
      else{
        if(index===1&&other.status!=='locked')fail('first_lock_required');
        if(index===0&&other.status!=='empty')fail('invalid_trade_stage');
        signature=chain==='nodus'?'open(bytes32,address,bytes32,uint64)':'open(bytes32,address,bytes32,uint256,uint64)';
        args=chain==='nodus'?[s.offer.id,leg.to,s.offer.hashlock,String(leg.refundAt)]:[s.offer.id,leg.to,s.offer.hashlock,leg.amountUnits,String(leg.refundAt)];valueWei=chain==='nodus'?leg.amountUnits:'0';
      }
    }else if(action==='claim'){
      if(own.status!=='locked')fail('not_locked');if(remaining<=0)fail('claim_expired');
      if(index===1){if(other.status!=='locked')fail('first_lock_required');const safetySeconds=Math.min(s.offer.takerRefundAt,s.offer.makerRefundAt)-clock-C().MARGIN;if(safetySeconds<=0)fail('claim_margin_too_short');safetyUntil=Math.min(safetyUntil,now+safetySeconds);}
      else{if(other.status!=='claimed')fail('secret_not_revealed');safetyUntil=Math.min(safetyUntil,now+remaining);}
      if(await C().hash(options.secret)!==s.offer.hashlock)fail('wrong_secret');
      signature='claim(address,bytes32,bytes32)';args=[leg.from,s.offer.id,options.secret];from=leg.to;
    }else{
      if(own.status!=='locked')fail('not_locked');if(remaining>0)fail('refund_not_ready');signature='refund(bytes32)';args=[s.offer.id];
    }
    let data;
    if(chain==='nodus')data=encodeNodus(signature,args);
    else{if(!E()?.Interface)fail('encoding_unavailable');const iface=new (E().Interface)(action==='approve'?['function approve(address spender,uint256 value)']:A().bsc.abi);data=iface.encodeFunctionData(action,args);}
    const relevant=action==='open'||action==='claim'?Object.values(report.legs):[own],expiresAt=Math.min(safetyUntil,...relevant.map(x=>x.checkedAt+FRESH_SECONDS));
    return {schema:REQUEST,chain,chainId:String(leg.chainId),action,offerId:s.offer.id,from,to,data,valueWei,...(chain==='bsc'?{assetToken:s.offer.asset.token}:{}),summary:action+' '+(chain==='nodus'?'NODUS EVM':'TEST-USDT on BSC testnet')+'; '+(action==='refund'?leg.from:action==='claim'?leg.to:to),notSent:true,containsSecret:action==='claim',independentVerification:false,preparedAt:now,expiresAt,validUntil:expiresAt};
  }
  globalThis.NodusTradeSession=Object.freeze({SCHEMA,REQUEST,MAX_BYTES,FRESH_SECONDS,createSession,validateSession,exportSession,importSession,recordTransaction,inspect,request});
})();
