// Real bytecode execution in a local standard EVM; no RPC endpoint or signing key leaves this process.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../tools/trade/package.json',import.meta.url));
const ganache=require('ganache'),{BrowserProvider,ContractFactory,sha256,hexlify,randomBytes}=require('ethers'),solc=require('solc');
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../../dist/trade-contracts.js',import.meta.url),'utf8'),context);const artifact=context.NodusTradeContracts.contracts.bnb;
const g=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:5},miner:{timestampIncrement:0}}),p=new BrowserProvider(g,undefined,{cacheTimeout:-1});p.pollingInterval=10;
try{
 const [a,b,c]=await Promise.all([0,1,2].map(i=>p.getSigner(i))),aa=await a.getAddress(),bb=await b.getAddress(),cc=await c.getAddress();
 const s=await new ContractFactory(artifact.abi,artifact.creation,a).deploy();await s.waitForDeployment();
 const secret=hexlify(randomBytes(32)),hash=sha256(secret),id=hexlify(randomBytes(32)),amount=1000000000000000n;
 const base=Number((await p.getBlock('latest')).timestamp),deadline=base+7200;
 const paid=async promise=>(await promise).wait();
 const reject=async(promise,name)=>assert.rejects(promise,e=>{assert.match(String(e),new RegExp(name));return true;});
 await reject(s.open.staticCall(id,bb,hash,base+100,{value:amount}),'InvalidTerms');
 await reject(s.open.staticCall(id,aa,hash,deadline,{value:amount}),'InvalidTerms');
 await reject(s.open.staticCall(id,bb,hash,deadline),'InvalidAmount');
 await paid(s.open(id,bb,hash,deadline,{value:amount}));assert.equal((await s.getSwap(aa,id)).status,1n);assert.equal(await s.lockedTotal(),amount);
 await reject(s.open.staticCall(id,bb,hash,deadline,{value:amount}),'SwapAlreadyExists');
 await paid(s.connect(c).open(id,bb,hash,deadline,{value:amount}));assert.equal(await s.lockedTotal(),2n*amount,'another funder owns a separate namespace');
 await reject(s.claim.staticCall(aa,id,secret),'NotRecipient');
 await reject(s.connect(b).claim.staticCall(aa,id,hexlify(randomBytes(32))),'WrongSecret');
 await reject(s.refund.staticCall(id),'RefundNotReady');
 const balance=await p.getBalance(bb);const tx=await s.connect(b).claim(aa,id,secret);const receipt=await tx.wait();
 assert.equal(await p.getBalance(bb),balance+amount-receipt.gasUsed*receipt.gasPrice);
 const event=receipt.logs.map(l=>{try{return s.interface.parseLog(l);}catch{return null;}}).find(x=>x?.name==='Claimed');assert.equal(event.args.secret,secret,'claim publishes the exact preimage for the other leg');
 assert.equal((await s.getSwap(aa,id)).status,2n);assert.equal(await s.lockedTotal(),amount);
 await reject(s.connect(b).claim.staticCall(aa,id,secret),'SwapNotLocked');await reject(s.refund.staticCall(id),'SwapNotLocked');
 await g.request({method:'evm_setTime',params:[new Date((deadline-1)*1000)]});await g.request({method:'evm_mine',params:[]});await reject(s.connect(c).refund.staticCall(id),'RefundNotReady');
 await g.request({method:'evm_setTime',params:[new Date(deadline*1000)]});await g.request({method:'evm_mine',params:[]});await reject(s.connect(b).claim.staticCall(cc,id,secret),'ClaimExpired');
 await paid(s.connect(c).refund(id));assert.equal((await s.getSwap(cc,id)).status,3n);assert.equal(await s.lockedTotal(),0n);
 // A receiving contract that rejects payment cannot consume the claim; then test a re-entry attempt.
 const mock=`pragma solidity =0.8.30; interface I {function claim(address,bytes32,bytes32) external;} contract Actor { bool public rejectPayment=true; bool public reentered; address target; address funder; bytes32 tradeId; bytes32 secret; function setReject(bool x) external {rejectPayment=x;} function take(address t,address f,bytes32 i,bytes32 x) external {target=t;funder=f;tradeId=i;secret=x;I(t).claim(f,i,x);} receive() external payable {require(!rejectPayment);try I(target).claim(funder,tradeId,secret){reentered=true;}catch{}} }`;
 const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'Actor.sol':{content:mock}},settings:{evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}))).contracts['Actor.sol'].Actor;
 const actor=await new ContractFactory(out.abi,'0x'+out.evm.bytecode.object,a).deploy();await actor.waitForDeployment();const id2=hexlify(randomBytes(32)),d2=deadline+7200;
 await paid(s.open(id2,await actor.getAddress(),hash,d2,{value:amount}));
 await assert.rejects(actor.take.staticCall(await s.getAddress(),aa,id2,secret));assert.equal((await s.getSwap(aa,id2)).status,1n);
 await paid(actor.setReject(false));await paid(actor.take(await s.getAddress(),aa,id2,secret));assert.equal(await actor.reentered(),false);assert.equal(await p.getBalance(await actor.getAddress()),amount);assert.equal(await s.lockedTotal(),0n);
 const wrong=ganache.provider({logging:{quiet:true},chain:{chainId:56}});try{const w=new BrowserProvider(wrong,undefined,{cacheTimeout:-1}),signer=await w.getSigner();const contract=await new ContractFactory(artifact.abi,artifact.creation,signer).deploy();await contract.waitForDeployment();await reject(contract.open.staticCall(hexlify(randomBytes(32)),bb,hash,deadline+14400,{value:1}),'WrongNetwork');}finally{await wrong.disconnect();}
 console.log('Trade BNB bytecode: lock, namespaces, exact payout, secret event, refund boundaries, replay, payment rollback, reentrancy and mainnet refusal PASS.');
}finally{await g.disconnect();}
