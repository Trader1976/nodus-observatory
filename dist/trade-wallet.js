/* Optional BSC testnet signer. Private keys stay in the selected browser wallet. */
(() => {
  'use strict';
  const CHAIN='0x61', ZERO='0x'+'0'.repeat(40), HASH=/^0x[0-9a-f]{64}$/i;
  const methods=['function token() view returns(address)','function decimals() view returns(uint8)','function faucet()',
    'function approve(address,uint256) returns(bool)','function open(bytes32,address,bytes32,uint256,uint64)',
    'function claim(address,bytes32,bytes32)','function refund(bytes32)'];
  let provider=null,epoch=0,busy=false,address=null,lastSubmission=null;
  const usedRequests=new WeakSet();
  const E=()=>globalThis.ethers,A=()=>globalThis.NodusTradeContracts.contracts;
  function fail(code){throw Object.assign(new Error(code),{code});}
  const now=()=>Math.floor(Date.now()/1000);
  const state=()=>({connected:!!address,address,chainId:address?97:null,busy,lastSubmission:lastSubmission&&{...lastSubmission}});
  function changed(){address=null;++epoch;globalThis.dispatchEvent?.(new CustomEvent('nodus-trade-wallet-change'));}
  const rpc=(method,params=[])=>provider.request({method,params});
  function normalized(x){try{const a=E().getAddress(x).toLowerCase();if(a===ZERO)fail('invalid_address');return a;}catch{fail('invalid_address');}}
  async function snapshot(){
    if(!provider||!address)fail('wallet_not_connected');
    const generation=epoch,chain=await rpc('eth_chainId');
    if(String(chain).toLowerCase()!==CHAIN){changed();fail('wrong_network');}
    const accounts=await rpc('eth_accounts');
    if(!Array.isArray(accounts)||!accounts.length||normalized(accounts[0])!==address){changed();fail('wallet_changed');}
    if(epoch!==generation)fail('wallet_changed');
    return {generation,from:address};
  }
  async function connect(){
    if(busy)fail('wallet_busy');busy=true;
    try{
      const p=globalThis.ethereum;
      if(!p||typeof p.request!=='function')fail('wallet_unavailable');
      if(p!==provider){if(provider?.removeListener){provider.removeListener('accountsChanged',changed);provider.removeListener('chainChanged',changed);provider.removeListener('disconnect',changed);}provider=p;++epoch;provider.on?.('accountsChanged',changed);provider.on?.('chainChanged',changed);provider.on?.('disconnect',changed);}
      const generation=epoch,accounts=await rpc('eth_requestAccounts');
      if(epoch!==generation)fail('wallet_changed');
      if(String(await rpc('eth_chainId')).toLowerCase()!==CHAIN){address=null;fail('wrong_network');}
      if(!Array.isArray(accounts)||!accounts.length)fail('wallet_not_connected');
      address=normalized(accounts[0]);await snapshot();return state();
    }catch(error){address=null;if(error.code===4001)fail('wallet_rejected');if(typeof error.code==='string')throw error;fail('wallet_connection_failed');}
    finally{busy=false;}
  }
  async function verifyToken(token){
    const t=normalized(token),code=await rpc('eth_getCode',[t,'latest']);
    if(typeof code!=='string'||code.toLowerCase()!==A().mockUsdt.runtime.toLowerCase())fail('wrong_token_code');
    const iface=new(E().Interface)(methods),result=await rpc('eth_call',[{to:t,data:iface.encodeFunctionData('decimals')},'latest']);
    if(iface.decodeFunctionResult('decimals',result)[0]!==18n)fail('invalid_asset');return t;
  }
  async function verifySwap(contract,token){
    const to=normalized(contract),code=await rpc('eth_getCode',[to,'latest']);
    if(typeof code!=='string'||code.toLowerCase()!==A().bsc.runtime.toLowerCase())fail('wrong_contract_code');
    const iface=new(E().Interface)(methods),result=await rpc('eth_call',[{to,data:iface.encodeFunctionData('token')},'latest']);
    if(normalized(iface.decodeFunctionResult('token',result)[0])!==await verifyToken(token))fail('wrong_token');
  }
  function base(action,from){return {schema:'nodus-trade/wallet-request-v1',chain:'bsc',chainId:97,action,from,valueWei:'0',preparedAt:now(),expiresAt:now()+30,notSent:true};}
  async function prepareDeployment(kind,{token}={}){
    const {from}=await snapshot();
    if(!['bsc','mockUsdt'].includes(kind))fail('invalid_action');
    let data=A()[kind].creation,assetToken;
    if(kind==='bsc'){assetToken=await verifyToken(token);data=new(E().ContractFactory)(A().bsc.abi,data).getDeployTransaction(assetToken);data=(await data).data;}
    return {...base('deploy',from),deploymentKind:kind,...(assetToken?{assetToken}:{}),data,summary:kind==='bsc'?'Deploy TEST-USDT swap on BSC testnet 97':'Deploy freely minted TEST-USDT; no monetary value'};
  }
  async function prepareFaucet(token){const {from}=await snapshot(),to=await verifyToken(token);return {...base('faucet',from),to,assetToken:to,data:new(E().Interface)(methods).encodeFunctionData('faucet'),summary:'Mint free TEST-USDT on BSC testnet 97; no monetary value'};}
  async function validate(request,from){
    if(!request||request.schema!=='nodus-trade/wallet-request-v1'||request.chain!=='bsc'||String(request.chainId)!=='97'||request.notSent!==true||normalized(request.from)!==from||request.valueWei!=='0')fail('invalid_wallet_request');
    if(!Number.isSafeInteger(request.preparedAt)||!Number.isSafeInteger(request.expiresAt)||request.preparedAt>now()+5||now()>=request.expiresAt||request.expiresAt-request.preparedAt>30)fail('request_expired');
    if(typeof request.data!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(request.data)||request.data.length>100000)fail('invalid_wallet_request');
    const iface=new(E().Interface)(methods),action=request.action;
    if(action==='deploy'){
      const expected=await prepareDeployment(request.deploymentKind,{token:request.assetToken});
      if(request.to!==undefined||request.data.toLowerCase()!==expected.data.toLowerCase())fail('invalid_wallet_request');
    }else if(action==='faucet'){
      if(normalized(request.to)!==await verifyToken(request.assetToken)||request.data!==iface.encodeFunctionData('faucet'))fail('invalid_wallet_request');
    }else if(['approve','open','claim','refund'].includes(action)){
      let values;try{values=iface.decodeFunctionData(action,request.data);}catch{fail('invalid_wallet_request');}
      if(iface.encodeFunctionData(action,values).toLowerCase()!==request.data.toLowerCase())fail('invalid_wallet_request');
      if(action==='approve'){
        if(normalized(request.to)!==await verifyToken(request.assetToken)||values[1]<=0n)fail('invalid_wallet_request');
        await verifySwap(values[0],request.assetToken);
      }else{
        await verifySwap(request.to,request.assetToken);
        if(action==='open'&&(!HASH.test(values[0])||/^0x0+$/.test(values[0])||!HASH.test(values[2])||/^0x0+$/.test(values[2])||values[3]<=0n||values[4]<BigInt(now()+3600)||values[4]>BigInt(now()+604800)))fail('invalid_wallet_request');
      }
    }else fail('invalid_action');
    return {from,chainId:CHAIN,...(request.to?{to:normalized(request.to)}:{}),data:request.data,value:'0x0'};
  }
  async function submit(request){
    if(busy)fail('wallet_busy');if(request&&usedRequests.has(request))fail('request_used');busy=true;let sent=false;
    try{
      const before=await snapshot(),tx=await validate(request,before.from);
      // A claim contains the preimage. Do not send an extra estimation request
      // before the user's explicit disclosure action. The wallet may still
      // simulate it itself; cancellation cannot make a disclosed secret private.
      const gas=request.action==='claim'?500000n:BigInt(await rpc('eth_estimateGas',[tx]));
      if(gas<=0n||gas>8000000n)fail('simulation_failed');
      tx.gas='0x'+((gas*120n+99n)/100n).toString(16);
      const after=await snapshot();if(after.generation!==before.generation||after.from!==before.from)fail('wallet_changed');
      if(now()>=request.expiresAt)fail('request_expired');
      sent=true;usedRequests.add(request);
      const hash=await rpc('eth_sendTransaction',[tx]);
      if(typeof hash!=='string'||!HASH.test(hash))fail('submission_uncertain');
      lastSubmission={hash:hash.toLowerCase(),status:'submitted',chain:'bsc',action:request.action,submittedAt:now()};
      return {...lastSubmission};
    }catch(error){
      if(error.code===4001)fail('wallet_rejected');
      if(sent){lastSubmission={hash:null,status:'unknown',chain:'bsc',action:request?.action||'unknown',submittedAt:now()};fail('submission_uncertain');}
      if(typeof error.code==='string')throw error;
      fail('simulation_failed');
    }finally{busy=false;}
  }
  globalThis.NodusTradeWallet=Object.freeze({connect,getState:state,prepareDeployment,prepareFaucet,submit});
})();
