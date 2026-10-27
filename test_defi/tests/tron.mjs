/* Mocked wallet/chain tests: these verify adapter boundaries and recovery,
 * never claim an actual TronLink extension or live-chain transfer was tested. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const source=fs.readFileSync(new URL('../frontend/tron.js',import.meta.url),'utf8');
const sender='TRKLH73z6t3c5DGeRxRGqY8XE8vekLrvfg';
const token='TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const recipient='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const genesis={nile:'0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc',shasta:'0000000000000000de1aa88295e1fcf982742f773e0419c5a9c134c994a9059e'};
const profiles={nile:{key:'nile',name:'TRON Nile',chainId:'0xcd8690dc',rpc:'https://nile.trongrid.io',token:{address:token,symbol:'test USDT',decimals:6}},shasta:{key:'shasta',name:'TRON Shasta',chainId:'0x94a9059e',rpc:'https://api.shasta.trongrid.io',token:null}};
const hexAddress=address=>'41'+(address===sender?'11':address===token?'22':'33').repeat(20);
const clone=value=>JSON.parse(JSON.stringify(value));
const rawHex=body=>Buffer.from(JSON.stringify(body)).toString('hex');
const txHash=body=>createHash('sha256').update(Buffer.from(rawHex(body),'hex')).digest('hex');
const uint=value=>BigInt(value).toString(16).padStart(64,'0');
const locks=()=>{let tail=Promise.resolve();return {request:(_name,_options,callback)=>{const result=tail.then(callback);tail=result.catch(()=>{});return result;}};};
function harness(options={}){
  const listeners=new Map(),windowListeners=new Map(),store=options.sharedStore??new Map(options.store??[]),trace=[];
  let chain=options.chain??'nile',receipt={},signMode='',broadcastMode='',nonce=0;
  const tw={ready:true,defaultAddress:{base58:sender},
    fullNode:{host:chain==='nile'?profiles.nile.rpc:chain==='shasta'?profiles.shasta.rpc:'https://api.trongrid.io'},
    solidityNode:{host:chain==='nile'?profiles.nile.rpc:profiles.shasta.rpc,request:async()=>clone(receipt)},
    isAddress:value=>[sender,token,recipient].includes(value),address:{toHex:hexAddress},
    utils:{transaction:{txJsonToPb:tx=>tx.raw_data,txPbToTxID:txHash,txPbToRawDataHex:rawHex}},
    trx:{
      getBlock:async number=>{assert.equal(number,0);return {blockID:genesis[chain]??'0'.repeat(64)};},
      getBalance:async()=>1000000000,
      getContract:async()=>({bytecode:'6001'}),
      sign:async tx=>{trace.push('sign');if(signMode==='reject')throw 'Confirmation declined by user';if(signMode==='change')change('chainChanged',{chainId:profiles.shasta.chainId});if(signMode==='silent-change')tw.fullNode.host=profiles.shasta.rpc;const signed=clone(tx);signed.signature=['a'.repeat(130)];if(signMode==='mutate')signed.raw_data.contract[0].parameter.value.call_value=1;return signed;},
      sendRawTransaction:async tx=>{trace.push('broadcast');assert.ok([...store.values()].some(text=>JSON.parse(text).some(item=>item.txID===tx.txID&&item.status==='signed')),'durable ID exists BEFORE broadcast');if(broadcastMode==='throw')throw Error('timeout');return broadcastMode==='reject'?{result:false}:{result:true,txid:tx.txID};},
    },
    transactionBuilder:{
      triggerConstantContract:async(address,method)=>{assert.equal(address,token);return {result:{result:true},constant_result:[uint(method==='decimals()'?6:1000000000)]};},
      triggerSmartContract:async(address,selector,settings,parameters,owner)=>{
        assert.equal(address,token);assert.equal(selector,'transfer(address,uint256)');assert.equal(owner,sender);assert.equal(settings.callValue,0);assert.equal(settings.feeLimit,100000000);
        const body={contract:[{parameter:{value:{owner_address:hexAddress(owner),contract_address:hexAddress(address),data:'a9059cbb'+hexAddress(parameters[0].value).slice(2).padStart(64,'0')+uint(parameters[1].value)}},type:'TriggerSmartContract'}],expiration:Date.now()+60000,timestamp:Date.now(),fee_limit:settings.feeLimit,ref_block_bytes:String(++nonce)};
        return {result:{result:true},transaction:{txID:txHash(body),raw_data:body,raw_data_hex:rawHex(body)}};
      },
    },
  };
  const provider={isTronLink:true,tronWeb:tw,
    request:async({method,params})=>{trace.push(method);if(options.rejectConnect)throw {code:4001};if(options.legacyOnly&&method==='eth_requestAccounts')throw {code:4200};if(method==='tron_requestAccounts')return {code:200};if(method==='wallet_switchEthereumChain'){chain=params[0].chainId===profiles.nile.chainId?'nile':'shasta';tw.fullNode.host=profiles[chain].rpc;tw.solidityNode.host=profiles[chain].rpc;return null;}return [sender];},
    on:(event,fn)=>listeners.set(event,fn),removeListener:(event,fn)=>{if(listeners.get(event)===fn)listeners.delete(event);},
  };
  const scope={NodusDefiNetworks:{profiles},tron:options.legacy?null:provider,tronLink:options.legacy?provider:null,navigator:{locks:options.noLocks?null:options.sharedLocks??locks()},
    localStorage:{getItem:key=>{if(options.storageReadThrows)throw Error('blocked');return store.get(key)??null;},setItem:(key,value)=>{trace.push('persist');if(options.storageThrows)throw Error('blocked');store.set(key,value);}},
    addEventListener:(event,fn)=>windowListeners.set(event,fn),removeEventListener:event=>windowListeners.delete(event),
  };
  const context=vm.createContext({console});vm.runInContext(source,context);
  const adapter=context.NodusDefiTron.create({scope});
  function change(event,payload){listeners.get(event)?.(payload);}
  return {adapter,provider,tw,scope,trace,store,change,windowListeners,
    setReceipt:value=>{receipt=value;},setSign:value=>{signMode=value;},setBroadcast:value=>{broadcastMode=value;},
  };
}
const check=async(test)=>{await test();};
await check(async()=>{
  const h=harness();assert.equal(h.trace.length,0,'constructing adapter does not request accounts or chain reads');
  await h.adapter.connect();const state=h.adapter.getState();
  assert.equal(state.connected,true);assert.equal(state.network,'nile');assert.equal(state.address,sender);
  assert.equal(state.balances.trxRaw,'1000000000');assert.equal(state.balances.tokenRaw,'1000000000');
  const review=await h.adapter.prepareTransfer(recipient,'12.000001');assert.equal(review.amountRaw,'12000001');assert.equal(review.feeLimitSun,'100000000');
  assert.equal(h.trace.includes('sign'),false,'reviewing does not sign');
  const result=await h.adapter.submitTransfer(review.id);assert.equal(result.status,'pending');
  assert.equal(h.trace.filter(item=>item==='broadcast').length,1);assert.ok(h.trace.indexOf('persist')<h.trace.indexOf('sign'));
  await assert.rejects(h.adapter.submitTransfer(review.id),/no longer current/,'review is one-shot');
  h.setReceipt({id:result.txID,blockNumber:42,receipt:{result:'SUCCESS'},fee:12000});
  await h.adapter.reconcile();assert.equal(h.adapter.getState().pending[0].status,'confirmed');assert.equal(h.adapter.getState().pending[0].feeSun,'12000');
});
await check(async()=>{
  for(const amount of ['0','-1','1e2','0.0000001','1.0000001','01','1,5',' 1','1.']){
    const h=harness();await h.adapter.connect();await assert.rejects(h.adapter.prepareTransfer(recipient,amount),/positive amount/);assert.equal(h.trace.includes('sign'),false);
  }
  const h=harness();await h.adapter.connect();await assert.rejects(h.adapter.prepareTransfer('<script>','1'),/recipient/);
  await assert.rejects(h.adapter.prepareTransfer(recipient,'1001'),/balance is too low/);
});
await check(async()=>{
  const h=harness({chain:'mainnet'});await assert.rejects(h.adapter.connect(),/Mainnet/);assert.equal(h.adapter.getState().connected,false);assert.equal(h.trace.includes('sign'),false);
  const wrong=harness();wrong.tw.trx.getBlock=async()=>({blockID:genesis.shasta});await assert.rejects(wrong.adapter.connect(),/wrong genesis/);
});
await check(async()=>{
  const account=harness();await account.adapter.connect();account.tw.defaultAddress.base58=recipient;
  await assert.rejects(account.adapter.prepareTransfer(recipient,'1'),/account or network changed/);
  assert.equal(account.adapter.getState().connected,false);assert.equal(account.adapter.getState().balances.tokenRaw,null);
  const chain=harness();await chain.adapter.connect();chain.tw.fullNode.host='https://api.trongrid.io';
  await assert.rejects(chain.adapter.refresh(),/Mainnet/);
  assert.equal(chain.adapter.getState().connected,false);assert.equal(chain.adapter.getState().balances.tokenRaw,null);
});
await check(async()=>{
  const h=harness();await h.adapter.connect();const review=await h.adapter.prepareTransfer(recipient,'1');
  h.change('accountsChanged',[]);assert.equal(h.adapter.getState().connected,false);assert.equal(h.adapter.getState().balances.tokenRaw,null);
  await assert.rejects(h.adapter.submitTransfer(review.id),/no longer current/);assert.equal(h.trace.includes('sign'),false);
  await h.adapter.connect();const next=await h.adapter.prepareTransfer(recipient,'1');h.setSign('change');
  await assert.rejects(h.adapter.submitTransfer(next.id),/account or network changed/);assert.equal(h.trace.includes('broadcast'),false);
});
await check(async()=>{
  const h=harness();await h.adapter.connect();const review=await h.adapter.prepareTransfer(recipient,'1');h.setSign('silent-change');
  await assert.rejects(h.adapter.submitTransfer(review.id),/account or network changed/);assert.equal(h.trace.includes('broadcast'),false);
});
await check(async()=>{
  const h=harness();await h.adapter.connect();const review=await h.adapter.prepareTransfer(recipient,'1');h.setSign('reject');
  await assert.rejects(h.adapter.submitTransfer(review.id),/declined/);assert.equal(h.trace.includes('broadcast'),false);assert.equal(h.adapter.getState().pending.length,0);
  const rejected=harness({rejectConnect:true});await assert.rejects(rejected.adapter.connect(),/declined/);assert.deepEqual(rejected.trace,['eth_requestAccounts'],'a rejected modern connect never falls back to another prompt');
});
await check(async()=>{
  for(const options of [{storageThrows:true},{storageReadThrows:true}]){
    const h=harness(options);await h.adapter.connect();const review=await h.adapter.prepareTransfer(recipient,'1');
    await assert.rejects(h.adapter.submitTransfer(review.id),/storage|journal/);assert.equal(h.trace.includes('sign'),false);assert.equal(h.trace.includes('broadcast'),false);
  }
  const h=harness({noLocks:true});await h.adapter.connect();const review=await h.adapter.prepareTransfer(recipient,'1');
  await assert.rejects(h.adapter.submitTransfer(review.id),/browser locking/);assert.equal(h.trace.includes('sign'),false);
});
await check(async()=>{
  for(const mode of ['throw','reject']){
    const h=harness();await h.adapter.connect();h.setBroadcast(mode);const review=await h.adapter.prepareTransfer(recipient,'1'),tx=await h.adapter.submitTransfer(review.id);
    assert.equal(tx.status,'unknown');await h.adapter.reconcile();assert.equal(h.adapter.getState().pending[0].status,'unknown','empty receipt cannot turn uncertain broadcast into failure');
    const restored=harness({store:[...h.store]});assert.equal(restored.adapter.getState().pending[0].txID,tx.txID,'journal survives page reload without signatures');
    assert.equal([...h.store.values()][0].includes('signature'),false);
    await restored.adapter.connect();restored.setReceipt({id:tx.txID,blockNumber:43,receipt:{result:'REVERT'}});await restored.adapter.reconcile();assert.equal(restored.adapter.getState().pending[0].status,'failed');
    assert.equal(h.trace.filter(item=>item==='broadcast').length,1,'reconcile never rebroadcasts');
  }
});
await check(async()=>{
  const h=harness({legacy:true});await h.adapter.connect();assert.equal(h.trace[0],'tron_requestAccounts');
  const review=await h.adapter.prepareTransfer(recipient,'1');
  h.windowListeners.get('message')({source:h.scope,data:{message:{action:'setNode'}}});
  await assert.rejects(h.adapter.submitTransfer(review.id),/no longer current/);
  const fallback=harness({legacyOnly:true});await fallback.adapter.connect();assert.deepEqual(fallback.trace.slice(0,2),['eth_requestAccounts','tron_requestAccounts']);
});
await check(async()=>{
  const h=harness();await h.adapter.connect();await h.adapter.setNetwork('shasta');assert.equal(h.adapter.getState().selectedNetwork,'shasta');assert.equal(h.adapter.getState().connected,false);
  await h.adapter.connect('shasta');assert.equal(h.adapter.getState().token,null);assert.equal(h.adapter.getState().balances.tokenRaw,null);
  await assert.rejects(h.adapter.prepareTransfer(recipient,'1'),/No reviewed test token/);
  await assert.rejects(h.adapter.setNetwork('mainnet'),/supported test network/);
});
await check(async()=>{
  const h=harness();await h.adapter.connect();const original=h.tw.transactionBuilder.triggerSmartContract;
  h.tw.transactionBuilder.triggerSmartContract=async(...args)=>{const tx=await original(...args);tx.transaction.raw_data.contract[0].parameter.value.data='a9059cbb'+'0'.repeat(128);return tx;};
  await assert.rejects(h.adapter.prepareTransfer(recipient,'1'),/unexpected transaction/);
  h.tw.transactionBuilder.triggerSmartContract=async(...args)=>{const tx=await original(...args);tx.transaction.raw_data_hex+='00';return tx;};
  await assert.rejects(h.adapter.prepareTransfer(recipient,'1'),/bytes do not match/);
  h.tw.transactionBuilder.triggerSmartContract=original;const review=await h.adapter.prepareTransfer(recipient,'1');h.setSign('mutate');
  await assert.rejects(h.adapter.submitTransfer(review.id),/differs from/);assert.equal(h.trace.includes('broadcast'),false);
});
await check(async()=>{
  const h=harness();await h.adapter.connect();h.tw.transactionBuilder.triggerConstantContract=async()=>({result:{result:true},constant_result:[uint(18)]});
  await assert.rejects(h.adapter.refresh(),/unexpected decimals/);
  const next=harness();await next.adapter.connect();next.tw.trx.getContract=async()=>({bytecode:''});
  await assert.rejects(next.adapter.prepareTransfer(recipient,'1'),/no code/);
  next.adapter.destroy();assert.equal(next.windowListeners.size,0);await assert.rejects(next.adapter.connect(),/closed/);
});
await check(async()=>{
  const sharedStore=new Map(),sharedLocks=locks();
  const first=harness({sharedStore,sharedLocks}),second=harness({sharedStore,sharedLocks});
  // Both tabs read the empty journal before either writes. Concurrent signing
  // and broadcast must retain BOTH IDs, including when a third tab reconciles.
  await Promise.all([first.adapter.connect(),second.adapter.connect()]);
  const [one,two]=await Promise.all([first.adapter.prepareTransfer(recipient,'1'),second.adapter.prepareTransfer(recipient,'2')]);
  await Promise.all([first.adapter.submitTransfer(one.id),second.adapter.submitTransfer(two.id)]);
  let saved=JSON.parse([...sharedStore.values()][0]);assert.equal(saved.length,2);assert.ok(saved.every(item=>item.status==='pending'));
  first.setReceipt({id:one.txID,blockNumber:44,receipt:{result:'SUCCESS'}});
  await first.adapter.reconcile();
  await second.adapter.reconcile();saved=JSON.parse([...sharedStore.values()][0]);
  assert.equal(saved.find(item=>item.txID===one.txID).status,'confirmed','stale tab cannot demote a final receipt');
  assert.equal(saved.find(item=>item.txID===two.txID).status,'pending');
  second.setReceipt({id:two.txID,blockNumber:44,receipt:{result:'UNRECOGNIZED_FUTURE_STATUS'}});
  await second.adapter.reconcile();assert.equal(second.adapter.getState().pending.find(item=>item.txID===two.txID).status,'pending','unknown execution result remains unresolved');
});
console.log('TronLink adapter: network identity, exact test-token amounts, reviewed signing, durable recovery, lifecycle and mismatch checks passed.');
