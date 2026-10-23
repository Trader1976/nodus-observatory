// Execute actual BSC token HTLC bytecode in a local EVM. No live keys or broadcasts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../tools/trade/package.json',import.meta.url));
const ganache=require('ganache'),{BrowserProvider,ContractFactory,sha256,hexlify,randomBytes}=require('ethers'),solc=require('solc');
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../../dist/trade-contracts.js',import.meta.url),'utf8'),context);
const {bsc:artifact,mockUsdt:mock}=context.NodusTradeContracts.contracts;
const g=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:5},miner:{timestampIncrement:0}}),p=new BrowserProvider(g,undefined,{cacheTimeout:-1});p.pollingInterval=10;
const paid=async promise=>(await promise).wait(),id=()=>hexlify(randomBytes(32));
const reject=async(promise,name)=>assert.rejects(promise,e=>{if(name)assert.match(String(e),new RegExp(name));return true;});
async function deploy(a,signer,args=[]){const c=await new ContractFactory(a.abi,a.creation,signer).deploy(...args);await c.waitForDeployment();return c;}
try{
 const [a,b,c]=await Promise.all([0,1,2].map(i=>p.getSigner(i))),aa=await a.getAddress(),bb=await b.getAddress(),cc=await c.getAddress();
 const token=await deploy(mock,a),ta=await token.getAddress();assert.equal(await token.symbol(),'TEST-USDT');assert.equal(await token.decimals(),18n);
 await paid(token.faucet());await paid(token.connect(c).faucet());assert.equal(await token.balanceOf(aa),1000000n*10n**18n);
 const s=await deploy(artifact,a,[ta]),sa=await s.getAddress();assert.equal(await s.token(),ta);assert.equal(await p.getCode(sa),artifact.runtime);
 const secret=id(),hash=sha256(secret),tradeId=id(),amount=1000n*10n**18n+1n;
 const base=Number((await p.getBlock('latest')).timestamp),deadline=base+7200;
 await reject(s.open.staticCall(tradeId,bb,hash,0,deadline),'InvalidAmount');
 await reject(s.open.staticCall(tradeId,aa,hash,amount,deadline),'InvalidTerms');
 await reject(s.open.staticCall(tradeId,ta,hash,amount,deadline),'InvalidTerms');
 await reject(s.open.staticCall(tradeId,bb,hash,amount,base+100),'InvalidTerms');
 await reject(s.open.staticCall(tradeId,bb,hash,amount,deadline),'PaymentFailed');
 assert.equal((await s.getSwap(aa,tradeId)).status,0n);assert.equal(await s.lockedTotal(),0n);
 await paid(token.approve(sa,amount-1n));await reject(s.open.staticCall(tradeId,bb,hash,amount,deadline),'PaymentFailed');
 await paid(token.approve(sa,amount));await reject(s.open.staticCall(tradeId,bb,hash,amount,deadline,{value:1n}));
 const funderBefore=await token.balanceOf(aa);await paid(s.open(tradeId,bb,hash,amount,deadline));
 assert.equal(await token.balanceOf(aa),funderBefore-amount);assert.equal(await token.balanceOf(sa),amount);assert.equal(await token.allowance(aa,sa),0n);assert.equal(await s.lockedTotal(),amount);
 assert.equal((await s.getSwap(aa,tradeId)).amount,amount);await reject(s.open.staticCall(tradeId,bb,hash,amount,deadline),'SwapAlreadyExists');
 await paid(token.connect(c).approve(sa,amount));await paid(s.connect(c).open(tradeId,bb,hash,amount,deadline));assert.equal(await s.lockedTotal(),2n*amount);
 await reject(s.claim.staticCall(aa,tradeId,secret),'NotRecipient');await reject(s.connect(b).claim.staticCall(aa,tradeId,id()),'WrongSecret');await reject(s.refund.staticCall(tradeId),'RefundNotReady');
 const recipientBefore=await token.balanceOf(bb),receipt=await paid(s.connect(b).claim(aa,tradeId,secret));
 assert.equal(await token.balanceOf(bb),recipientBefore+amount);assert.equal(await token.balanceOf(sa),amount);assert.equal((await s.getSwap(aa,tradeId)).status,2n);assert.equal(await s.lockedTotal(),amount);
 const event=receipt.logs.map(l=>{try{return s.interface.parseLog(l);}catch{return null;}}).find(x=>x?.name==='Claimed');assert.equal(event.args.secret,secret);
 await reject(s.connect(b).claim.staticCall(aa,tradeId,secret),'SwapNotLocked');await reject(s.refund.staticCall(tradeId),'SwapNotLocked');
 await g.request({method:'evm_setTime',params:[new Date((deadline-1)*1000)]});await g.request({method:'evm_mine',params:[]});await reject(s.connect(c).refund.staticCall(tradeId),'RefundNotReady');
 await g.request({method:'evm_setTime',params:[new Date(deadline*1000)]});await g.request({method:'evm_mine',params:[]});await reject(s.connect(b).claim.staticCall(cc,tradeId,secret),'ClaimExpired');
 const refundBefore=await token.balanceOf(cc);await paid(s.connect(c).refund(tradeId));assert.equal(await token.balanceOf(cc),refundBefore+amount);assert.equal((await s.getSwap(cc,tradeId)).status,3n);assert.equal(await s.lockedTotal(),0n);
 await reject(a.sendTransaction({to:sa,value:1n}));
 // A stored fixed token has an independent identity even when runtime matches.
 const token2=await deploy(mock,a),s2=await deploy(artifact,a,[await token2.getAddress()]);assert.equal(await p.getCode(await s2.getAddress()),artifact.runtime);assert.notEqual(await s2.token(),await s.token());
 await reject(deploy(artifact,a,[aa]));await reject(deploy(artifact,a,['0x'+'00'.repeat(20)]));

 // Deliberately unusual token: modes test optional returns, failures and taxes.
 const source=`// SPDX-License-Identifier: MIT
 pragma solidity =0.8.30;
 contract WeirdToken {
   uint256 public mode; mapping(address=>uint256) balances; mapping(address=>mapping(address=>uint256)) public allowance;
   address target; bytes callback; bool public callbackAttempted; bool public callbackSucceeded; bytes4 public callbackError;
   constructor(){balances[msg.sender]=10**30;}
   function setMode(uint256 m) external {mode=m;}
   function decimals() external view returns(uint256){return mode==10?6:18;}
   function setCallback(address t,bytes calldata d) external {target=t;callback=d;}
   function balanceOf(address a) external view returns(uint256){if(mode==9){assembly{return(0,0)}} return balances[a];}
   function approve(address s,uint256 a) external returns(bool){allowance[msg.sender][s]=a;return true;}
   function transfer(address to,uint256 a) external returns(bool){_move(msg.sender,to,a);return _reply();}
   function transferFrom(address from,address to,uint256 a) external returns(bool){require(allowance[from][msg.sender]>=a);allowance[from][msg.sender]-=a;_move(from,to,a);return _reply();}
   function _move(address from,address to,uint256 a) private {uint256 debit=mode==7?a+1:a;uint256 credit=mode==6?a-1:a;require(balances[from]>=debit);balances[from]-=debit;balances[to]+=credit;if(target!=address(0)){callbackAttempted=true;(bool ok,bytes memory data)=target.call(callback);callbackSucceeded=ok;if(data.length>=4)callbackError=bytes4(data);}}
   function _reply() private view returns(bool){if(mode==1){assembly{return(0,0)}} if(mode==2)return false;if(mode==3){assembly{mstore(0,1) return(31,1)}}if(mode==4){assembly{mstore(0,2) return(0,32)}}if(mode==5)revert();return true;}
 }`;
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'WeirdToken.sol':{content:source}},settings:{evmVersion:'paris',optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
 assert(!output.errors?.some(x=>x.severity==='error'),JSON.stringify(output.errors));const wArtifact=output.contracts['WeirdToken.sol'].WeirdToken,wa={abi:wArtifact.abi,creation:'0x'+wArtifact.evm.bytecode.object};
 const weird=await deploy(wa,a),wt=await weird.getAddress(),sw=await deploy(artifact,a,[wt]),swAddress=await sw.getAddress(),d2=deadline+7200;
 await paid(weird.approve(swAddress,100n*amount));
 for(const mode of [2,3,4,5,6,7]){
   await paid(weird.setMode(mode));const tid=id(),balanceBefore=await weird.balanceOf(aa),allowanceBefore=await weird.allowance(aa,swAddress);
   await reject(sw.open.staticCall(tid,bb,hash,amount,d2),mode>=6?'InexactTransfer':'PaymentFailed');
   // Send with explicit gas to exercise actual mined rollback, not only eth_call.
   await reject(paid(sw.open(tid,bb,hash,amount,d2,{gasLimit:1500000})));
   assert.equal((await sw.getSwap(aa,tid)).status,0n);assert.equal(await sw.lockedTotal(),0n);assert.equal(await weird.balanceOf(swAddress),0n);assert.equal(await weird.balanceOf(aa),balanceBefore);assert.equal(await weird.allowance(aa,swAddress),allowanceBefore);
 }
 // Both supported return conventions settle correctly.
 for(const mode of [0,1]){await paid(weird.setMode(mode));const tid=id(),before=await weird.balanceOf(bb);await paid(sw.open(tid,bb,hash,amount,d2));await paid(sw.connect(b).claim(aa,tid,secret));assert.equal(await weird.balanceOf(bb),before+amount);assert.equal(await sw.lockedTotal(),0n);}
 // Outgoing failure/tax preserves the locked record and all token balances.
 await paid(weird.setMode(0));const failedId=id();await paid(sw.open(failedId,bb,hash,amount,d2));
 for(const mode of [2,3,4,5,6,7]){await paid(weird.setMode(mode));const before=await weird.balanceOf(bb);await reject(paid(sw.connect(b).claim(aa,failedId,secret,{gasLimit:1500000})));assert.equal((await sw.getSwap(aa,failedId)).status,1n);assert.equal(await sw.lockedTotal(),amount);assert.equal(await weird.balanceOf(swAddress),amount);assert.equal(await weird.balanceOf(bb),before);}
 await paid(weird.setMode(10));await reject(deploy(artifact,a,[wt]));
 await paid(weird.setMode(9));await reject(sw.connect(b).claim.staticCall(aa,failedId,secret),'InvalidToken');await reject(deploy(artifact,a,[wt]));
 await paid(weird.setMode(0));
 // Token callback cannot enter any mutation while an incoming transfer is active.
 const reentryId=id(),payload=sw.interface.encodeFunctionData('open',[id(),cc,hash,1n,d2]);await paid(weird.setCallback(swAddress,payload));await paid(sw.open(reentryId,bb,hash,amount,d2));assert.equal(await weird.callbackAttempted(),true);assert.equal(await weird.callbackSucceeded(),false);assert.equal(await weird.callbackError(),sw.interface.getError('ReentrantCall').selector);
 await paid(sw.connect(b).claim(aa,reentryId,secret));assert.equal(await weird.callbackSucceeded(),false);assert.equal(await weird.callbackError(),sw.interface.getError('ReentrantCall').selector);
 await paid(weird.setCallback('0x'+'00'.repeat(20),'0x'));
 // Refunds use the same checked transfer and roll back on a frozen/failed token.
 await g.request({method:'evm_setTime',params:[new Date(d2*1000)]});await g.request({method:'evm_mine',params:[]});await paid(weird.setMode(2));await reject(paid(sw.refund(failedId,{gasLimit:1500000})));assert.equal((await sw.getSwap(aa,failedId)).status,1n);assert.equal(await sw.lockedTotal(),amount);
 await paid(weird.setMode(1));const refundBalance=await weird.balanceOf(aa);await paid(sw.refund(failedId));assert.equal(await weird.balanceOf(aa),refundBalance+amount);assert.equal(await sw.lockedTotal(),0n);
 const wrong=ganache.provider({logging:{quiet:true},chain:{chainId:56}});try{const wp=new BrowserProvider(wrong,undefined,{cacheTimeout:-1}),signer=await wp.getSigner();await reject(deploy(mock,signer));await reject(deploy(artifact,signer,[ta]));}finally{await wrong.disconnect();}
 console.log('Trade BSC token bytecode: exact approvals/payouts/refunds, fixed token identity, legacy no-return, false/malformed/revert/tax rollback, callback guard, deadlines, replay and mainnet refusal PASS.');
}finally{await g.disconnect();}
