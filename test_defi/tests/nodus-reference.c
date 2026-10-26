/* Offline execution of the ERC20 REFERENCE, not native UTXO tUSDT support.
 * Reuse the pinned engine's ABI/transaction helpers, then exercise our bytecode.
 * High-byte twins have identical low20 bytes: tests must preserve all32 bytes.
 */
#define main nodus_library_harness_main
#include "test_contract_lib.c"
#undef main

enum { LOAN = 0, TOKEN = 1, REJECT = 2, REENTER = 3 };
static const char *CREATE = "createOffer(uint256,uint256,uint16,uint16,uint8,uint64)";
static void number(ctx_t *c, const uint8_t *to, const char *sig, enc_t e, uint64_t want, const char *what) {
    uint8_t out[32]; view(c,to,sig,e,out,what); ck_u64(c,out,want,what);
}
static void status(ctx_t *c, const uint8_t *loan, uint64_t id, uint64_t want, const char *what) {
    uint8_t out[32];view_at(c,loan,"getOffer(uint256)",E(U(id)),12,out,what);ck_u64(c,out,want,what);
}
static void liability(ctx_t *c, const uint8_t *loan, const uint8_t *token, uint64_t tusd, uint64_t nodus) {
    number(c,loan,"tokenLiability()",E0(),tusd,"token liability");
    number(c,token,"balanceOf(address)",E(loan),tusd,"escrow+credit equals token balance");
    number(c,loan,"collateralLiability()",E0(),nodus,"collateral liability");
    ck_u64v(c,bal(c,loan),nodus,"collateral balance covers active loans+credits");
}

int main(int argc, char **argv) {
    if(argc!=2)return 2;
    init_inputs();ctx_t c;memset(&c,0,sizeof(c));c.cfg="DeFi offline reference";
    const char *names[]={"LendingReference","MockUSDT6","MockRejectNative","MockReenterNative"};
    for(int i=0;i<4;i++)if(load_hex(argv[1],"actual",names[i],"creation",&c.creation[i])||load_hex(argv[1],"actual",names[i],"runtime",&c.runtime[i]))return 2;
    evm_membackend_init(&c.mb);for(int i=0;i<S_COUNT;i++)add_eoa(&c.mb,ACC[i],FUND_EOA);
    if(evm_membackend_finalize(&c.mb))return 2;evm_membackend_bind(&c.mb,&c.be);
    c.ec.fork=EVM_FORK_PRAGUE;c.ec.addr_bytes=32;c.ec.precompile_mask=EVM_PRECOMPILES_PRAGUE;c.ec.nodus_profile=1;
    memcpy(c.ec.ticket_addr.b,TICKET,32);evm_u256_from_u64(&c.ec.ticket_unit,Q);c.ec.ticket_gas=25000;
    const char *chain="a48d1a785500a1cdecd739ecd53ef0e95b1dc4a7a300f49176a7fa25ae176114";
    uint8_t chainbytes[32];for(int i=0;i<32;i++)chainbytes[i]=(uint8_t)(hexval(chain[2*i])*16+hexval(chain[2*i+1]));
    evm_u256_from_be(&c.ec.chain_id,chainbytes);c.env.number=1000;c.env.timestamp=T0;c.env.gas_limit=BLOCK_GAS;
    c.st=evm_state_new(&c.ec,&c.be);if(!c.st)return 2;
    uint8_t loan[32],token[32],reject[32],reenter[32],out[32];
    if(deploy(&c,S_A,TOKEN,E0(),0,token,NULL,"deploy six-decimal mock"))return 2;
    deploy_rev(&c,S_A,LOAN,E(A),"InvalidToken()",NULL,0,"EOA cannot be token");
    call_ok(&c,S_A,token,0,"setDecimals(uint8)",E(U(18)),NULL,"configure wrong token decimals");
    deploy_rev(&c,S_A,LOAN,E(token),"InvalidToken()",NULL,0,"18-decimal token refused");
    call_ok(&c,S_A,token,0,"setDecimals(uint8)",E(U(6)),NULL,"restore six decimals");
    if(deploy(&c,S_A,LOAN,E(token),0,loan,NULL,"deploy addr256 loan reference"))return 2;
    if(deploy(&c,S_A,REJECT,E0(),0,reject,NULL,"deploy rejecting receiver"))return 2;
    if(deploy(&c,S_A,REENTER,E(loan),0,reenter,NULL,"deploy reentering receiver"))return 2;
    call_ok(&c,S_A,token,0,"mint(address,uint256)",E(A,U(100000000000ull)),NULL,"fund lender mock tokens");
    call_ok(&c,S_A,token,0,"mint(address,uint256)",E(B,U(100000000000ull)),NULL,"fund borrower mock tokens");
    const uint64_t p=1000000000ull,coll=100*Q,fee=6575343ull,total=p+fee,expiry=T0+7*86400;
    number(&c,loan,"calculateInterest(uint256,uint16,uint16)",E(U(p),U(800),U(30)),fee,"1000 at8% for30days rounds up once");
    number(&c,loan,"calculateInterest(uint256,uint16,uint16)",E(U(1),U(1),U(1)),1,"tiny interest rounds up");
    uint8_t huge[32];memset(huge,0xff,32);
    call_rev(&c,S_A,loan,0,CREATE,E(huge,U(coll),U(800),U(30),U(3),U(expiry)),"InvalidTerms()",NULL,0,"oversized principal refused before multiplication");
    call_rev(&c,S_A,loan,0,CREATE,E(U(p),huge,U(800),U(30),U(3),U(expiry)),"InvalidAmount()",NULL,0,"oversized collateral refused");
    call_rev(&c,S_A,loan,0,CREATE,E(U(p),U(0),U(800),U(30),U(3),U(expiry)),"InvalidAmount()",NULL,0,"zero collateral refused");
    call_rev(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(30),U(31),U(expiry)),"InvalidTerms()",NULL,0,"grace above bound refused");
    call_rev(&c,S_A,loan,0,CREATE,E(U(0),U(coll),U(800),U(30),U(3),U(expiry)),"InvalidTerms()",NULL,0,"zero principal refused");
    call_rev(&c,S_A,loan,0,CREATE,E(U(p),U(coll+1),U(800),U(30),U(3),U(expiry)),"InvalidAmount()",NULL,0,"unrepresentable NODUS dust refused");
    call_rev(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(5001),U(30),U(3),U(expiry)),"InvalidTerms()",NULL,0,"APR above bound refused");
    call_rev(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(366),U(3),U(expiry)),"InvalidTerms()",NULL,0,"term above bound refused");
    call_rev(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(30),U(0),U(expiry)),"InvalidTerms()",NULL,0,"zero grace refused");
    call_rev(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(30),U(3),U(T0)),"InvalidTerms()",NULL,0,"nonfuture expiry refused");
    call_rev(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(30),U(3),U(T0+31*86400)),"InvalidTerms()",NULL,0,"expiry above30days refused");
    call_rev(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(30),U(3),U(expiry)),"TokenTransferFailed()",NULL,0,"unfunded offer cannot be published");
    number(&c,loan,"nextOfferId()",E0(),1,"failed funding rolls back id");liability(&c,loan,token,0,0);
    call_ok(&c,S_A,token,0,"approve(address,uint256)",E(loan,U(100000000000ull)),NULL,"approve lender escrow");
    call_rev(&c,S_A,loan,Q,CREATE,E(U(p),U(coll),U(800),U(30),U(3),U(expiry)),NULL,NULL,0,"funding offer rejects accidental native value");
    call_ok(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(30),U(3),U(expiry)),NULL,"fund indivisible offer1");
    status(&c,loan,1,1,"offer1 open");liability(&c,loan,token,p,0);
    view_at(&c,loan,"getOffer(uint256)",E(U(1)),0,out,"lender full address");ck_addr(&c,out,A,"lender retains high12 bytes");
    call_rev(&c,S_A_TWIN,loan,0,"cancel(uint256)",E(U(1)),"Unauthorized()",NULL,0,"lender twin cannot cancel");
    call_rev(&c,S_A,loan,coll,"accept(uint256)",E(U(1)),"Unauthorized()",NULL,0,"self-loan refused");
    call_rev(&c,S_B,loan,coll-1,"accept(uint256)",E(U(1)),"InvalidAmount()",NULL,0,"short collateral refused");
    call_rev(&c,S_B,loan,coll+Q,"accept(uint256)",E(U(1)),"InvalidAmount()",NULL,0,"excess collateral refused");
    // Every malformed/fake-success token operation must roll back both state and balances.
    for(int mode=1;mode<=4;mode++){
        call_ok(&c,S_A,token,0,"setMode(uint8)",E(U(mode)),NULL,"set malicious token mode");
        call_rev(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(30),U(3),U(expiry)),"TokenTransferFailed()",NULL,0,"bad transferFrom cannot fund");
        number(&c,loan,"nextOfferId()",E0(),2,"failed funding preserves sequence");
        call_rev(&c,S_B,loan,coll,"accept(uint256)",E(U(1)),"TokenTransferFailed()",NULL,0,"bad transfer cannot activate");
        status(&c,loan,1,1,"failed accept stays open");liability(&c,loan,token,p,0);
    }
    call_ok(&c,S_A,token,0,"setMode(uint8)",E(U(0)),NULL,"restore exact token");
    // A token callback cannot enter any guarded economic operation.
    buf_t hook;mk_call(&hook,"cancel(uint256)",E(U(1)));
    enc_t he=E0();enc_word(&he,loan);enc_bytes(&he,hook.b,hook.n);
    call_ok(&c,S_A,token,0,"setHook(address,bytes)",he,NULL,"install token callback");buf_free(&hook);
    call_ok(&c,S_B,loan,coll,"accept(uint256)",E(U(1)),NULL,"accept full offer1");
    view(&c,token,"hookError()",E0(),out,"token hook guard error");ck_sel(&c,out,"ReentrantCall()","token reentry refused");
    he=E0();enc_word(&he,ZERO);enc_bytes(&he,NULL,0);call_ok(&c,S_A,token,0,"setHook(address,bytes)",he,NULL,"remove callback");
    status(&c,loan,1,2,"offer1 active");liability(&c,loan,token,0,coll);
    view_at(&c,loan,"getOffer(uint256)",E(U(1)),1,out,"borrower full address");ck_addr(&c,out,B,"borrower retains high12bytes");
    call_rev(&c,S_C,loan,coll,"accept(uint256)",E(U(1)),"InvalidState()",NULL,0,"second borrower cannot reuse offer");
    call_rev(&c,S_A,loan,0,"cancel(uint256)",E(U(1)),"InvalidState()",NULL,0,"active principal cannot be cancelled");
    call_rev(&c,S_B_TWIN,loan,0,"repay(uint256)",E(U(1)),"Unauthorized()",NULL,0,"borrower twin cannot settle");
    call_rev(&c,S_A,loan,0,"claimDefault(uint256)",E(U(1)),"TooEarly()",NULL,0,"premature collateral seizure refused");
    call_rev(&c,S_B,loan,0,"repay(uint256)",E(U(1)),"TokenTransferFailed()",NULL,0,"repay without allowance refused");
    call_ok(&c,S_B,token,0,"approve(address,uint256)",E(loan,U(100000000000ull)),NULL,"approve repayment");
    for(int mode=1;mode<=4;mode++){
        call_ok(&c,S_A,token,0,"setMode(uint8)",E(U(mode)),NULL,"set bad repayment token mode");
        call_rev(&c,S_B,loan,0,"repay(uint256)",E(U(1)),"TokenTransferFailed()",NULL,0,"bad repayment rolls back");
        status(&c,loan,1,2,"failed repayment stays active");
        number(&c,loan,"tokenCredit(address)",E(A),0,"failed repayment creates no lender credit");
        number(&c,loan,"collateralCredit(address)",E(B),0,"failed repayment releases no collateral");
        liability(&c,loan,token,0,coll);
    }
    call_ok(&c,S_A,token,0,"setMode(uint8)",E(U(0)),NULL,"restore token for repayment");
    call_ok(&c,S_B,loan,0,"repay(uint256)",E(U(1)),NULL,"early repay charges full-term interest");
    status(&c,loan,1,3,"loan1 repaid");liability(&c,loan,token,total,coll);
    number(&c,loan,"tokenCredit(address)",E(A),total,"lender gets principal plus full fee");
    number(&c,loan,"collateralCredit(address)",E(B),coll,"borrower gets collateral credit");
    number(&c,loan,"collateralCredit(address)",E(B_TWIN),0,"borrower twin has no credit");
    call_rev(&c,S_B_TWIN,loan,0,"withdrawCollateral(address)",E(B_TWIN),"InvalidAmount()",NULL,0,"borrower twin cannot withdraw credit");
    call_rev(&c,S_A_TWIN,loan,0,"withdrawToken(address)",E(A_TWIN),"InvalidAmount()",NULL,0,"lender twin cannot withdraw credit");
    call_rev(&c,S_B,loan,0,"repay(uint256)",E(U(1)),"InvalidState()",NULL,0,"repay replay refused");
    call_rev(&c,S_A,loan,0,"claimDefault(uint256)",E(U(1)),"InvalidState()",NULL,0,"settled collateral cannot be seized");
    call_rev(&c,S_B,loan,0,"withdrawCollateral(address)",E(reject),"NativeTransferFailed()",NULL,0,"rejecting receiver preserves collateral");
    number(&c,loan,"collateralCredit(address)",E(B),coll,"failed withdrawal preserves credit");
    uint64_t before=bal(&c,reenter);
    call_ok(&c,S_B,loan,0,"withdrawCollateral(address)",E(reenter),NULL,"withdraw collateral to alternative receiver");
    ck_u64v(&c,bal(&c,reenter),before+coll,"native paid exactly once");
    view(&c,reenter,"hookError()",E0(),out,"native receiver guard error");ck_sel(&c,out,"ReentrantCall()","native withdrawal reentry refused");
    call_rev(&c,S_B,loan,0,"withdrawCollateral(address)",E(B),"InvalidAmount()",NULL,0,"native withdrawal replay refused");
    for(int mode=1;mode<=4;mode++){
        call_ok(&c,S_A,token,0,"setMode(uint8)",E(U(mode)),NULL,"set bad withdrawal token mode");
        call_rev(&c,S_A,loan,0,"withdrawToken(address)",E(C),"TokenTransferFailed()",NULL,0,"bad lender withdrawal reverts");
        number(&c,loan,"tokenCredit(address)",E(A),total,"failed token withdrawal preserves credit");
    }
    call_ok(&c,S_A,token,0,"setMode(uint8)",E(U(0)),NULL,"restore token withdrawals");
    call_ok(&c,S_A,loan,0,"withdrawToken(address)",E(C),NULL,"withdraw lender credit to chosen receiver");
    number(&c,token,"balanceOf(address)",E(C),total,"receiver gets principal and full fee");liability(&c,loan,token,0,0);
    // Cancellation is permissioned but also works after offer expiry.
    call_ok(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(30),U(3),U(expiry)),NULL,"fund offer2 cancellation");
    call_rev(&c,S_B,loan,0,"cancel(uint256)",E(U(2)),"Unauthorized()",NULL,0,"borrower cannot cancel offer");
    call_ok(&c,S_A,loan,0,"cancel(uint256)",E(U(2)),NULL,"lender cancels unused offer");
    status(&c,loan,2,4,"offer2 cancelled");
    call_rev(&c,S_B,loan,coll,"accept(uint256)",E(U(2)),"InvalidState()",NULL,0,"cancelled offer cannot be taken");
    call_ok(&c,S_A,loan,0,"withdrawToken(address)",E(A),NULL,"withdraw cancelled principal");
    call_ok(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(1),U(1),U(T0+86400)),NULL,"fund expiring offer3");
    call_ok(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(1),U(1),U(expiry)),NULL,"fund default offer4");
    call_ok(&c,S_A,loan,0,CREATE,E(U(p),U(coll),U(800),U(1),U(1),U(expiry)),NULL,"fund boundary repayment offer5");
    call_ok(&c,S_B,loan,coll,"accept(uint256)",E(U(4)),NULL,"activate default loan4");
    call_ok(&c,S_B,loan,coll,"accept(uint256)",E(U(5)),NULL,"activate boundary loan5");
    at_time(&c,T0+86400);
    call_rev(&c,S_B,loan,coll,"accept(uint256)",E(U(3)),"Expired()",NULL,0,"offer cannot be accepted exactly at expiry");
    call_ok(&c,S_A,loan,0,"cancel(uint256)",E(U(3)),NULL,"expired offer can be recovered");
    call_ok(&c,S_A,loan,0,"withdrawToken(address)",E(A),NULL,"withdraw expired offer funding");
    const uint64_t deadline=T0+2*86400,shortfee=219179ull;
    at_time(&c,deadline-1);
    call_rev(&c,S_A,loan,0,"claimDefault(uint256)",E(U(4)),"TooEarly()",NULL,0,"default deadline minus1 refused");
    call_ok(&c,S_B,loan,0,"repay(uint256)",E(U(5)),NULL,"repayment succeeds last second of grace");
    number(&c,loan,"tokenCredit(address)",E(A),p+shortfee,"short term fee ceiling matches exact amount");
    call_ok(&c,S_A,loan,0,"withdrawToken(address)",E(A),NULL,"withdraw loan5 repayment");
    call_ok(&c,S_B,loan,0,"withdrawCollateral(address)",E(B),NULL,"withdraw loan5 collateral");
    at_time(&c,deadline);
    call_rev(&c,S_B,loan,0,"repay(uint256)",E(U(4)),"Expired()",NULL,0,"repayment closes at exact deadline");
    call_rev(&c,S_A_TWIN,loan,0,"claimDefault(uint256)",E(U(4)),"Unauthorized()",NULL,0,"lender twin cannot claim default");
    call_ok(&c,S_A,loan,0,"claimDefault(uint256)",E(U(4)),NULL,"lender claims collateral at exact deadline");
    status(&c,loan,4,5,"loan4 defaulted");
    number(&c,loan,"collateralCredit(address)",E(A),coll,"whole fixed collateral credited on default");
    call_rev(&c,S_A,loan,0,"claimDefault(uint256)",E(U(4)),"InvalidState()",NULL,0,"default replay refused");
    call_ok(&c,S_A,loan,0,"withdrawCollateral(address)",E(A),NULL,"withdraw default collateral");
    liability(&c,loan,token,0,0);
    post_code(&c);
    printf("DeFi OFFLINE ERC20 reference: %u checks passed, %u failed (Nodus32-byte engine; NOT native tUSDT).\n",c.pass,c.fail);
    unsigned failed=c.fail;ctx_close(&c);return failed?1:0;
}
