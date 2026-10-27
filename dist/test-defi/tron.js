/* Direct TronLink adapter for the Observatory testnet workbench.
 * Keys stay in TronLink; signed transactions return here for broadcast. Only
 * test networks/tokens: it is not a bridge or a cross-chain lending contract.
 * API references: docs.tronlink.org/dapp/getting-started/ and TronWeb's
 * triggerSmartContract / protobuf transaction utilities. Genesis identities:
 * https://namespaces.chainagnostic.org/tron/caip2 .
 */
(() => {
  'use strict';
  const GENESIS = Object.freeze({
    nile:'0000000000000000d698d4192c56cb6be724a558448e2684802de4d6cd8690dc',
    shasta:'0000000000000000de1aa88295e1fcf982742f773e0419c5a9c134c994a9059e',
  });
  const HOSTS = Object.freeze({nile:['https://nile.trongrid.io','https://api.nileex.io'],shasta:['https://api.shasta.trongrid.io']});
  const JOURNAL = 'nodus-defi-tron-transactions-v1', FEE = 100000000, MAX = 100;
  // protocol.Transaction.Result.contractResult execution failures. Unknown or
  // newly introduced values remain unresolved instead of guessing finality.
  const FAILED = new Set(['REVERT','OUT_OF_ENERGY','OUT_OF_TIME','BAD_JUMP_DESTINATION','OUT_OF_MEMORY','PRECOMPILED_CONTRACT','STACK_TOO_SMALL','STACK_TOO_LARGE','ILLEGAL_OPERATION','JVM_STACK_OVER_FLOW','TRANSFER_FAILED','INVALID_CODE']);
  const clone = value => JSON.parse(JSON.stringify(value));
  const hex = value => String(value??'').replace(/^0x/,'').toLowerCase();
  const raw = value => {
    if(typeof value==='number'&&!Number.isSafeInteger(value))throw Error('The wallet returned an imprecise amount.');
    const result=String(value??'');
    if(!/^(0|[1-9][0-9]*)$/.test(result))throw Error('The wallet returned an invalid amount.');
    return result;
  };
  const parseAmount = value => {
    if(typeof value!=='string'||! /^(?:0|[1-9][0-9]{0,20})(?:\.[0-9]{1,6})?$/.test(value))throw Error('Enter a positive amount with at most 6 decimals.');
    const [whole,fraction='']=value.split('.'), amount=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
    if(amount<=0n||amount>2n**256n-1n)throw Error('Enter a positive amount with at most 6 decimals.');
    return amount.toString();
  };
  const rejection = error => error?.code===4001||error==='Confirmation declined by user';
  const errorText = error => rejection(error)?'The wallet request was declined.':error instanceof Error?error.message:'The wallet request could not be completed.';

  function create({scope=globalThis,onChange=()=>{}}={}) {
    let provider=null,legacy=false,revision=0,review=null,disposed=false,attached=null;
    let journal=[],journalValid=true;
    const state={connected:false,address:null,selectedNetwork:'nile',network:null,chainId:null,
      balances:{trxRaw:null,tokenRaw:null},token:null,busy:false,error:null,pending:[]};
    const profiles=()=>scope.NodusDefiNetworks?.profiles??globalThis.NodusDefiNetworks?.profiles??{};
    const profile=key=>{
      const result=profiles()[key];
      if(!Object.hasOwn(GENESIS,key)||!result||result.chainId!=='0x'+GENESIS[key].slice(-8))throw Error('Select a supported test network.');
      return result;
    };
    const notify=()=>{
      state.pending=journal.filter(item=>item.network===state.selectedNetwork&&(!state.address||item.from===state.address)).map(clone);
      if(!disposed)onChange(clone(state));
    };
    function readJournal(){
        const text=scope.localStorage?.getItem(JOURNAL);
        if(!text)return [];
        if(text.length>150000)throw Error('journal');
        const parsed=JSON.parse(text);
        if(!Array.isArray(parsed)||parsed.length>MAX||parsed.some(item=>!item||!Object.hasOwn(GENESIS,item.network)||! /^[0-9a-f]{64}$/.test(item.txID)||!['signed','pending','unknown','confirmed','failed'].includes(item.status)||typeof item.from!=='string'||typeof item.to!=='string'||! /^[1-9][0-9]*$/.test(item.amountRaw)||typeof item.createdAt!=='string'))throw Error('journal');
        return parsed;
    }
    function loadJournal(){
      try {
        journal=readJournal();
      } catch {journalValid=false;state.error='The saved transaction journal cannot be read. Sending is disabled.';}
    }
    async function saveJournal(updates){
      if(!journalValid)throw Error('The saved transaction journal cannot be read. Sending is disabled.');
      // A shared lock and a fresh read are both required: two open tabs must
      // never replace each other's durable signed/pending transaction IDs.
      if(!scope.navigator?.locks?.request)throw Error('Secure browser locking is unavailable. Use HTTPS or localhost before sending.');
      return scope.navigator.locks.request(JOURNAL,{mode:'exclusive'},()=>{
        try {
          if(!scope.localStorage)throw Error('storage');
          const merged=new Map(readJournal().map(item=>[item.txID,item]));
          for(const item of updates){
            const current=merged.get(item.txID);
            // A slower broadcast response must not demote a receipt another
            // tab has already reconciled to a final result.
            if(current&&['confirmed','failed'].includes(current.status))continue;
            merged.set(item.txID,item);
          }
          const next=[...merged.values()];
          while(next.length>MAX){const index=next.findIndex(item=>['confirmed','failed'].includes(item.status));if(index<0)throw Error('full');next.splice(index,1);}
          const value=JSON.stringify(next);
          scope.localStorage.setItem(JOURNAL,value);
          if(scope.localStorage.getItem(JOURNAL)!==value)throw Error('storage');
          journal=next;notify();
        } catch(error){
          if(error?.message==='full')throw Error('The pending transaction journal is full. Reconcile it before sending.');
          throw Error('Browser storage is unavailable. Nothing was broadcast.');
        }
      });
    }
    function invalidate(message=null){
      ++revision;review=null;state.connected=false;state.address=null;state.network=null;state.chainId=null;
      state.balances={trxRaw:null,tokenRaw:null};state.token=null;state.error=message;notify();
    }
    const changed=()=>invalidate('The wallet account or network changed. Connect again.');
    const legacyChanged=event=>{
      // Legacy events can be spoofed by the page; they only invalidate cached
      // state. They never authorize an account or identify a network.
      if(event.source&&event.source!==scope)return;
      if(['setAccount','setNode','disconnectWeb','rejectWeb'].includes(event.data?.message?.action))changed();
    };
    function attach(next){
      if(attached===next)return;
      if(attached?.removeListener)for(const name of ['accountsChanged','chainChanged','disconnect'])attached.removeListener(name,changed);
      attached=next;
      if(next?.on)for(const name of ['accountsChanged','chainChanged','disconnect'])next.on(name,changed);
    }
    const announced=event=>{
      if(event.detail?.info?.name==='TronLink'&&event.detail.provider?.isTronLink){provider=event.detail.provider;legacy=false;attach(provider);}
    };
    function detect(){
      if(scope.tron?.isTronLink){provider=scope.tron;legacy=false;}
      else if(scope.tronLink?.request){provider=scope.tronLink;legacy=true;}
      if(!provider)throw Error('Install TronLink and reload this page.');
      attach(provider);return provider;
    }
    function wallet(){
      const tw=provider?.tronWeb??(legacy?scope.tronWeb:null);
      if(!tw?.defaultAddress?.base58||tw.ready===false)throw Error('Unlock TronLink and connect this site.');
      return tw;
    }
    async function context(expectedKey=state.selectedNetwork){
      const selected=profile(expectedKey),tw=wallet(),address=tw.defaultAddress.base58;
      if(!tw.isAddress(address))throw Error('The wallet returned an invalid account.');
      // Events can be missed by extensions and mobile browsers. Never use a
      // new account while the page still displays the previous one's balance.
      if(state.connected&&state.address!==address){invalidate();throw Error('The wallet account or network changed. Connect again.');}
      const host=String(tw.fullNode?.host??'').replace(/\/$/,'');
      if(!HOSTS[expectedKey].includes(host)){invalidate();throw Error('Select '+selected.name+' in TronLink. Mainnet and custom RPCs are disabled.');}
      const before=revision,block=await tw.trx.getBlock(0);
      if(before!==revision||wallet()!==tw||tw.defaultAddress.base58!==address||String(tw.fullNode?.host??'').replace(/\/$/,'')!==host)throw Error('The wallet account or network changed. Connect again.');
      if(hex(block?.blockID)!==GENESIS[expectedKey]){invalidate();throw Error('The connected node has the wrong genesis block.');}
      return {tw,address,profile:selected,revision:before,host};
    }
    function stillCurrent(ctx){
      if(ctx.revision!==revision||wallet()!==ctx.tw||wallet().defaultAddress.base58!==ctx.address||state.selectedNetwork!==ctx.profile.key||String(ctx.tw.fullNode?.host??'').replace(/\/$/,'')!==ctx.host)throw Error('The wallet account or network changed. Connect again.');
    }
    async function constant(ctx,signature,parameters=[]){
      const response=await ctx.tw.transactionBuilder.triggerConstantContract(ctx.profile.token.address,signature,{},parameters,ctx.address);
      stillCurrent(ctx);
      const result=response?.constant_result;
      if(response?.result?.result!==true||!Array.isArray(result)||result.length!==1||! /^[0-9a-fA-F]{64}$/.test(result[0]))throw Error('The test token could not be read.');
      return BigInt('0x'+result[0]).toString();
    }
    async function tokenCheck(ctx){
      if(!ctx.profile.token)return null;
      const token=ctx.profile.token;
      // The reviewed faucet asset is pinned here as well as in the profile:
      // a symbol or an editable config field must not select a different token.
      if(ctx.profile.key!=='nile'||token.address!=='TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf'||token.decimals!==6)throw Error('No reviewed test token is configured for this network.');
      const code=await ctx.tw.trx.getContract(token.address);stillCurrent(ctx);
      if(! /^[0-9a-fA-F]+$/.test(code?.bytecode??'')||hex(code.bytecode).length<2)throw Error('The test token contract has no code.');
      if(await constant(ctx,'decimals()')!=='6')throw Error('The test token has unexpected decimals.');
      return clone(token);
    }
    async function read(){
      const ctx=await context();
      const trx=raw(await ctx.tw.trx.getBalance(ctx.address));stillCurrent(ctx);
      const token=await tokenCheck(ctx),balance=token?await constant(ctx,'balanceOf(address)',[{type:'address',value:ctx.address}]):null;
      stillCurrent(ctx);
      state.connected=true;state.address=ctx.address;state.network=ctx.profile.key;state.chainId=ctx.profile.chainId;
      state.balances={trxRaw:trx,tokenRaw:balance};state.token=token;notify();return ctx;
    }
    async function run(operation){
      if(disposed)throw Error('The wallet adapter is closed.');
      if(state.busy)throw Error('A wallet request is already in progress.');
      state.busy=true;state.error=null;notify();
      try {return await operation();}
      catch(error){state.error=errorText(error);notify();throw Error(state.error);}
      finally {state.busy=false;notify();}
    }
    async function connect(key='nile'){
      return run(async()=>{
        profile(key);invalidate();state.selectedNetwork=key;
        const p=detect();
        if(legacy){const response=await p.request({method:'tron_requestAccounts'});if(response?.code!==200)throw Error(response?.code===4001?'A wallet request is already in progress.':'The wallet request was declined.');}
        else {
          try {await p.request({method:'eth_requestAccounts'});}
          catch(error){
            if(![4200,-32601].includes(error?.code))throw error;
            const response=await p.request({method:'tron_requestAccounts'});
            if(response?.code!==200)throw Error('The wallet request was declined.');
          }
        }
        await read();return clone(state);
      });
    }
    function addressHex(tw,value){
      const result=hex(tw.address.toHex(value));
      if(! /^41[0-9a-f]{40}$/.test(result))throw Error('The wallet returned an invalid address.');
      return result;
    }
    function verifyTransaction(ctx,tx,expected){
      const body=tx?.raw_data,contracts=body?.contract;
      if(! /^[0-9a-f]{64}$/.test(hex(tx?.txID))||! /^[0-9a-f]+$/.test(hex(tx?.raw_data_hex))||!Array.isArray(contracts)||contracts.length!==1||contracts[0].type!=='TriggerSmartContract')throw Error('The node returned an unexpected transaction.');
      const contract=contracts[0],value=contract.parameter?.value;
      const calldata='a9059cbb'+addressHex(ctx.tw,expected.to).slice(2).padStart(64,'0')+BigInt(expected.amountRaw).toString(16).padStart(64,'0');
      if(contract.Permission_id||hex(value?.owner_address)!==addressHex(ctx.tw,ctx.address)||hex(value?.contract_address)!==addressHex(ctx.tw,ctx.profile.token.address)||hex(value?.data)!==calldata||Number(value?.call_value??0)!==0||Number(value?.call_token_value??0)!==0||value?.token_id||body.fee_limit!==FEE||!Number.isSafeInteger(body.expiration)||body.expiration<=Date.now()+5000||body.expiration>Date.now()+600000||!Number.isSafeInteger(body.timestamp)||Math.abs(Date.now()-body.timestamp)>300000)throw Error('The node returned an unexpected transaction.');
      // Re-encode the reviewed JSON. This prevents a node from showing one
      // destination in JSON while supplying different bytes for the signature.
      const utils=ctx.tw.utils?.transaction;
      if(!utils?.txJsonToPb||!utils?.txPbToTxID||!utils?.txPbToRawDataHex)throw Error('This TronLink version cannot verify transaction bytes. Update TronLink.');
      const pb=utils.txJsonToPb(tx);
      if(hex(utils.txPbToTxID(pb))!==hex(tx.txID)||hex(utils.txPbToRawDataHex(pb))!==hex(tx.raw_data_hex))throw Error('The transaction bytes do not match the review.');
      return tx;
    }
    async function prepareTransfer(to,amount){
      return run(async()=>{
        review=null;
        if(!state.connected)throw Error('Connect TronLink first.');
        const amountRaw=parseAmount(amount),ctx=await context();
        if(!ctx.tw.isAddress(to)||typeof to!=='string'||! /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(to))throw Error('Enter a valid TRON recipient address.');
        if(!ctx.profile.token)throw Error('No reviewed test token is configured for this network.');
        await tokenCheck(ctx);
        const balance=await constant(ctx,'balanceOf(address)',[{type:'address',value:ctx.address}]);
        if(BigInt(balance)<BigInt(amountRaw))throw Error('The test token balance is too low.');
        const built=await ctx.tw.transactionBuilder.triggerSmartContract(ctx.profile.token.address,'transfer(address,uint256)',{feeLimit:FEE,callValue:0},[{type:'address',value:to},{type:'uint256',value:amountRaw}],ctx.address);
        stillCurrent(ctx);
        if(built?.result?.result!==true)throw Error('The test token transfer could not be prepared.');
        const transaction=verifyTransaction(ctx,built.transaction,{to,amountRaw});
        const publicReview={id:hex(transaction.txID),network:ctx.profile.key,chainId:ctx.profile.chainId,from:ctx.address,to,tokenAddress:ctx.profile.token.address,symbol:ctx.profile.token.symbol,amountRaw,amount,feeLimitSun:String(FEE),txID:hex(transaction.txID),expiresAt:transaction.raw_data.expiration};
        review={...clone(publicReview),transaction:clone(transaction),revision};return clone(publicReview);
      });
    }
    async function submitTransfer(id){
      return run(async()=>{
        if(!review||id!==review.id||review.revision!==revision)throw Error('This review is no longer current. Prepare the transfer again.');
        const selected=review;review=null;
        const ctx=await context(selected.network);stillCurrent(ctx);
        if(ctx.address!==selected.from)throw Error('The wallet account changed. Prepare the transfer again.');
        verifyTransaction(ctx,selected.transaction,selected);
        // Verify storage before even opening a signing prompt. The signed
        // transaction itself is never stored; the ID is durable before send.
        await saveJournal([]);stillCurrent(ctx);
        const signed=await ctx.tw.trx.sign(clone(selected.transaction));
        stillCurrent(ctx);
        if(hex(signed?.txID)!==selected.txID||JSON.stringify(signed?.raw_data)!==JSON.stringify(selected.transaction.raw_data)||hex(signed?.raw_data_hex)!==hex(selected.transaction.raw_data_hex)||!Array.isArray(signed?.signature)||signed.signature.length!==1||! /^[0-9a-fA-F]{130}$/.test(signed.signature[0]))throw Error('The signed transaction differs from the reviewed transfer. Nothing was broadcast.');
        verifyTransaction(ctx,signed,selected);
        // Re-read genesis after the wallet popup: network/account switches can
        // happen while the user considers the signing request.
        const fresh=await context(selected.network);stillCurrent(ctx);
        if(fresh.address!==selected.from||fresh.tw!==ctx.tw)throw Error('The wallet account or network changed. Nothing was broadcast.');
        const record={txID:selected.txID,network:selected.network,chainId:selected.chainId,from:selected.from,to:selected.to,tokenAddress:selected.tokenAddress,amountRaw:selected.amountRaw,status:'signed',createdAt:new Date().toISOString()};
        await saveJournal([record]);
        stillCurrent(ctx);
        try {
          const result=await ctx.tw.trx.sendRawTransaction(signed);
          // A transport rejection may race another node accepting this same
          // transaction. Keep its ID unresolved until a solidified receipt.
          record.status=result?.result===true?'pending':'unknown';
          await saveJournal([record]);
          if(result?.result!==true)state.error='Broadcast status is uncertain. Check this transaction before sending again.';
        } catch {
          record.status='unknown';
          try {await saveJournal([record]);}catch {/* The durable signed ID is already sufficient for later reconciliation. */}
          state.error='Broadcast status is uncertain. Check this transaction before sending again.';
        }
        notify();return clone(record);
      });
    }
    async function reconcile(){
      return run(async()=>{
        if(!state.connected)throw Error('Connect TronLink first.');
        const ctx=await context(),next=clone(journal);
        if(!HOSTS[ctx.profile.key].includes(String(ctx.tw.solidityNode?.host??'').replace(/\/$/,'')))throw Error('The confirmation node is not an approved testnet endpoint.');
        for(const item of next.filter(item=>item.network===ctx.profile.key&&item.from===ctx.address&&!['confirmed','failed'].includes(item.status))){
          stillCurrent(ctx);
          try {
            // walletsolidity only: a FullNode's head receipt is not final.
            const info=await ctx.tw.solidityNode.request('walletsolidity/gettransactioninfobyid',{value:item.txID},'post');
            stillCurrent(ctx);
            if(hex(info?.id)!==item.txID||info.blockNumber==null||!info.receipt)continue;
            const result=info.receipt.result??info.result;
            if(result==='SUCCESS')item.status='confirmed';
            else if(FAILED.has(result))item.status='failed';
            else continue;
            item.lastCheckedAt=new Date().toISOString();item.blockNumber=raw(info.blockNumber);
            if(info.fee!=null)item.feeSun=raw(info.fee);
          } catch(error){if(ctx.revision!==revision)throw error;/* RPC outage leaves the transaction unresolved. */}
        }
        stillCurrent(ctx);await saveJournal(next);return clone(state.pending);
      });
    }
    loadJournal();
    scope.addEventListener?.('TIP6963:announceProvider',announced);
    scope.addEventListener?.('message',legacyChanged);
    if(scope.Event)scope.dispatchEvent?.(new scope.Event('TIP6963:requestProvider'));
    notify();
    return Object.freeze({getState:()=>clone(state),connect,
      disconnect(){invalidate();},refresh:()=>run(read),prepareTransfer,submitTransfer,reconcile,
      async setNetwork(key){return run(async()=>{const selected=profile(key);invalidate();state.selectedNetwork=key;notify();
        if(!provider)return;
        try {await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:selected.chainId}]});}
        catch(error){if([4200,-32601].includes(error?.code))throw Error('Select '+selected.name+' in TronLink, then connect again.');throw error;}
      });},
      destroy(){invalidate();disposed=true;scope.removeEventListener?.('TIP6963:announceProvider',announced);scope.removeEventListener?.('message',legacyChanged);attach(null);},
    });
  }
  globalThis.NodusDefiTron=Object.freeze({create});
})();
