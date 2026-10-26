/* Execute the exact exported OSD6/lending bytecode in a memory-only Nodus VM.
 * This is not a live-node, signed-envelope or native-tUSDT integration test.
 */
#define main nodus_library_harness_main
#include "test_contract_lib.c"
#undef main

static void number(ctx_t *c, const uint8_t *to, const char *sig, enc_t e, uint64_t want, const char *label) {
    uint8_t out[32]; view(c,to,sig,e,out,label); ck_u64(c,out,want,label);
}
static void state(ctx_t *c, const uint8_t *loan, uint64_t id, uint64_t want) {
    uint8_t out[32];view_at(c,loan,"getOffer(uint256)",E(U(id)),12,out,"offer status");ck_u64(c,out,want,"expected offer status");
}

int main(int argc, char **argv) {
    if(argc!=2)return 2;
    init_inputs();ctx_t c;memset(&c,0,sizeof(c));c.cfg="OSD6 wallet kit";
    const char *names[]={"LendingReference","SandboxDollar6"};
    for(int i=0;i<2;i++)if(load_hex(argv[1],"actual",names[i],"creation",&c.creation[i])||load_hex(argv[1],"actual",names[i],"runtime",&c.runtime[i]))return 2;
    evm_membackend_init(&c.mb);for(int i=0;i<S_COUNT;i++)add_eoa(&c.mb,ACC[i],FUND_EOA);
    if(evm_membackend_finalize(&c.mb))return 2;evm_membackend_bind(&c.mb,&c.be);
    c.ec.fork=EVM_FORK_PRAGUE;c.ec.addr_bytes=32;c.ec.precompile_mask=EVM_PRECOMPILES_PRAGUE;c.ec.nodus_profile=1;
    memcpy(c.ec.ticket_addr.b,TICKET,32);evm_u256_from_u64(&c.ec.ticket_unit,Q);c.ec.ticket_gas=25000;
    const char *chain="a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114";
    uint8_t chainbytes[32];for(int i=0;i<32;i++)chainbytes[i]=(uint8_t)(hexval(chain[2*i])*16+hexval(chain[2*i+1]));
    evm_u256_from_be(&c.ec.chain_id,chainbytes);c.env.number=1000;c.env.timestamp=T0;c.env.gas_limit=BLOCK_GAS;
    c.st=evm_state_new(&c.ec,&c.be);if(!c.st)return 2;
    uint8_t loan[32],token[32],out[32];const uint64_t supply=1000000000000ull;
    if(deploy(&c,S_A,1,E0(),0,token,NULL,"deploy fixed-supply OSD6"))return 2;
    number(&c,token,"decimals()",E0(),6,"six decimals");
    number(&c,token,"totalSupply()",E0(),supply,"one million OSD6 fixed supply");
    number(&c,token,"balanceOf(address)",E(A),supply,"all supply initially belongs to deployer");
    number(&c,token,"balanceOf(address)",E(A_TWIN),0,"high-byte twin does not own deployer balance");
    call_rev(&c,S_A,token,0,"mint(address,uint256)",E(B,U(1)),NULL,NULL,0,"no public mint entry point");
    call_rev(&c,S_A,token,0,"setMode(uint8)",E(U(1)),NULL,NULL,0,"no mock transfer-mode setter");
    call_rev(&c,S_A,token,0,"transfer(address,uint256)",E(ZERO,U(1)),"ZeroAddress()",NULL,0,"zero transfer recipient refused");
    call_rev(&c,S_A,token,0,"approve(address,uint256)",E(ZERO,U(1)),"ZeroAddress()",NULL,0,"zero allowance spender refused");
    call_rev(&c,S_B,token,0,"transfer(address,uint256)",E(C,U(1)),"InsufficientBalance()",NULL,0,"unfunded user cannot transfer");
    call_ok(&c,S_A,token,0,"transfer(address,uint256)",E(A,U(9)),NULL,"self-transfer preserves balance");
    number(&c,token,"balanceOf(address)",E(A),supply,"self-transfer conserves supply");
    call_ok(&c,S_A,token,0,"approve(address,uint256)",E(C,U(7)),NULL,"grant exact allowance");
    call_rev(&c,S_C,token,0,"transferFrom(address,address,uint256)",E(A,B,U(8)),"InsufficientAllowance()",NULL,0,"overspending allowance refused");
    call_rev(&c,S_A_TWIN,token,0,"transferFrom(address,address,uint256)",E(A,B,U(1)),"InsufficientAllowance()",NULL,0,"address twin has no allowance");
    call_rev(&c,S_C,token,0,"transferFrom(address,address,uint256)",E(A_TWIN,B,U(1)),"InsufficientAllowance()",NULL,0,"owner high-byte twin cannot reuse A allowance");
    call_ok(&c,S_C,token,0,"transferFrom(address,address,uint256)",E(A,B,U(7)),NULL,"spend exact allowance");
    number(&c,token,"allowance(address,address)",E(A,C),0,"allowance consumed exactly");
    number(&c,token,"balanceOf(address)",E(B),7,"recipient receives exact raw amount");
    call_ok(&c,S_A,token,0,"approve(address,uint256)",E(C,U(0)),NULL,"allowance revocation supported");
    if(deploy(&c,S_A,0,E(token),0,loan,NULL,"deploy lending with fixed OSD6"))return 2;
    view(&c,loan,"token()",E0(),out,"loan token address");ck_addr(&c,out,token,"loan retains full32byte token address");
    const uint64_t p=100000000ull,fee=657535ull,total=p+fee;
    /* Small native-wei collateral fits the upstream helper's uint64 balances.
     * It is 100 raw NODUS units (0.000001 NODUS), not the manual guide's100 NODUS.
     */
    const uint64_t coll=100*Q,expiry=T0+7*86400;
    call_ok(&c,S_A,token,0,"transfer(address,uint256)",E(B,U(fee)),NULL,"fund borrower test interest");
    call_ok(&c,S_A,token,0,"approve(address,uint256)",E(loan,U(p*3)),NULL,"approve three full offers");
    const char *create="createOffer(uint256,uint256,uint16,uint16,uint8,uint64)";
    call_ok(&c,S_A,loan,0,create,E(U(p),U(coll),U(800),U(30),U(3),U(expiry)),NULL,"fund loan1");
    number(&c,loan,"tokenLiability()",E0(),p,"funded principal liability");
    number(&c,token,"balanceOf(address)",E(loan),p,"funded principal balance");
    call_ok(&c,S_B,loan,coll,"accept(uint256)",E(U(1)),NULL,"borrow exact principal");state(&c,loan,1,2);
    number(&c,token,"balanceOf(address)",E(B),p+fee+7,"borrower receives principal plus previously funded fee");
    call_ok(&c,S_B,token,0,"approve(address,uint256)",E(loan,U(total)),NULL,"approve exact full-term repayment");
    call_ok(&c,S_B,loan,0,"repay(uint256)",E(U(1)),NULL,"repay full term");state(&c,loan,1,3);
    number(&c,loan,"tokenCredit(address)",E(A),total,"lender repayment credit");
    number(&c,loan,"collateralCredit(address)",E(B),coll,"borrower collateral credit");
    call_ok(&c,S_A,loan,0,"withdrawToken(address)",E(A),NULL,"withdraw lender repayment");
    call_ok(&c,S_B,loan,0,"withdrawCollateral(address)",E(B),NULL,"withdraw borrower collateral");
    call_ok(&c,S_A,loan,0,create,E(U(p),U(coll),U(800),U(30),U(3),U(expiry)),NULL,"fund unused offer2");
    call_ok(&c,S_A,loan,0,"cancel(uint256)",E(U(2)),NULL,"cancel unused offer2");
    call_ok(&c,S_A,loan,0,"withdrawToken(address)",E(A),NULL,"withdraw cancelled principal");state(&c,loan,2,4);
    call_ok(&c,S_A,loan,0,create,E(U(p),U(coll),U(800),U(1),U(1),U(expiry)),NULL,"fund default offer3");
    call_ok(&c,S_B,loan,coll,"accept(uint256)",E(U(3)),NULL,"accept default offer3");
    at_time(&c,T0+2*86400);
    call_ok(&c,S_A,loan,0,"claimDefault(uint256)",E(U(3)),NULL,"claim default at exact deadline");state(&c,loan,3,5);
    call_ok(&c,S_A,loan,0,"withdrawCollateral(address)",E(A),NULL,"withdraw default collateral");
    number(&c,loan,"tokenLiability()",E0(),0,"no remaining token liability");
    number(&c,loan,"collateralLiability()",E0(),0,"no remaining collateral liability");
    number(&c,token,"balanceOf(address)",E(loan),0,"no token escrow left");
    number(&c,token,"totalSupply()",E0(),supply,"supply unchanged by lending lifecycle");
    post_code(&c);
    printf("OSD6 wallet kit: %u checks passed, %u failed (memory-only Nodus32-byte engine; not native tUSDT).\n",c.pass,c.fail);
    unsigned failed=c.fail;ctx_close(&c);return failed?1:0;
}
